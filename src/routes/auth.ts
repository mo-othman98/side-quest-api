import { Router } from 'express';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { pool } from '../db';
import { AuthedRequest, requireAuth, signAccessToken } from '../middleware/auth';
import { generateVerificationToken, verificationExpiry } from '../utils/authTokens';
import { sendVerificationEmail } from '../services/emailService';
import { isGoogleAuthConfigured } from '../services/googleAuthService';
import { resolveGoogleProfile, googleAuthErrorMessage } from '../utils/googleProfile';
import { uniqueUsername } from '../utils/username';
import { validateUsername } from '../utils/validateUsername';
import {
  deleteCloudinaryAsset,
  isCloudinaryConfigured,
  uploadLocalFile,
} from '../services/mediaStorage';

const router = Router();
const BCRYPT_ROUNDS = 12;

const avatarsDir = path.join(__dirname, '../../uploads/avatars');
fs.mkdirSync(avatarsDir, { recursive: true });

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: avatarsDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = file.mimetype?.toLowerCase() ?? '';
    if (mime.startsWith('image/') || mime === 'application/octet-stream') {
      cb(null, true);
      return;
    }
    cb(new Error('Avatar must be an image'));
  },
});

interface UserRow {
  id: string;
  username: string;
  email: string;
  bio: string;
  xp: number;
  level: number;
  quests_completed: number;
  email_verified: boolean;
  avatar_url: string | null;
  created_at: string;
}

function resolveAvatarUrl(avatarUrl: string | null | undefined, baseUrl?: string): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith('http')) return avatarUrl;
  if (!baseUrl) return avatarUrl;
  return `${baseUrl}${avatarUrl.startsWith('/') ? '' : '/'}${avatarUrl}`;
}

function toPublicUser(row: UserRow, baseUrl?: string) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    bio: row.bio,
    xp: row.xp,
    level: row.level,
    questsCompleted: row.quests_completed,
    emailVerified: row.email_verified,
    avatarUrl: resolveAvatarUrl(row.avatar_url, baseUrl),
  };
}

async function findUserByEmail(email: string): Promise<UserRow | null> {
  if (!pool) return null;
  const result = await pool.query<UserRow>(
    `SELECT id, username, email, bio, xp, level, quests_completed, email_verified, avatar_url, created_at
     FROM users WHERE LOWER(email) = LOWER($1)`,
    [email.trim()]
  );
  return result.rows[0] ?? null;
}

async function findUserById(id: string): Promise<UserRow | null> {
  if (!pool) return null;
  const result = await pool.query<UserRow>(
    `SELECT id, username, email, bio, xp, level, quests_completed, email_verified, avatar_url, created_at
     FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

router.post('/register', async (req, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const { username, email, password } = req.body ?? {};

  if (!username?.trim() || !email?.trim() || !password) {
    res.status(400).json({ error: 'username, email, and password are required' });
    return;
  }

  if (username.trim().length < 3) {
    res.status(400).json({ error: 'Username must be at least 3 characters' });
    return;
  }

  const usernameCheck = validateUsername(username);
  if (!usernameCheck.ok) {
    res.status(400).json({ error: usernameCheck.error });
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    res.status(400).json({ error: 'Enter a valid email address' });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  try {
    const existing = await pool.query(
      `SELECT id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)`,
      [username.trim(), email.trim()]
    );

    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Username or email is already taken' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const verificationToken = generateVerificationToken();
    const tokenExpires = verificationExpiry();

    const insert = await pool.query<UserRow>(
      `INSERT INTO users (
        username, email, password_hash, bio, verification_token, verification_token_expires, email_verified
      ) VALUES ($1, $2, $3, $4, $5, $6, FALSE)
      RETURNING id, username, email, bio, xp, level, quests_completed, email_verified, avatar_url, created_at`,
      [
        username.trim(),
        email.trim().toLowerCase(),
        passwordHash,
        'New adventurer on Side Quest',
        verificationToken,
        tokenExpires,
      ]
    );

    const user = insert.rows[0];
    const token = signAccessToken({ userId: user.id, email: user.email });

    let emailMeta: { sent: boolean; devLink?: string } = { sent: false };
    try {
      emailMeta = await sendVerificationEmail(user.email, user.username, verificationToken);
    } catch (emailErr) {
      console.error('Verification email error:', emailErr);
    }

    res.status(201).json({
      token,
      user: toPublicUser(user, `${req.protocol}://${req.get('host')}`),
      emailVerification: emailMeta,
    });
  } catch (err) {
    console.error('register failed:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const { email, password } = req.body ?? {};

  if (!email?.trim() || !password) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  try {
    const result = await pool.query<UserRow & { password_hash: string }>(
      `SELECT id, username, email, password_hash, bio, xp, level, quests_completed, email_verified, avatar_url, created_at
       FROM users WHERE LOWER(email) = LOWER($1)`,
      [email.trim()]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    if (!row.password_hash) {
      res.status(401).json({ error: 'This account uses Google sign-in' });
      return;
    }

    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signAccessToken({ userId: row.id, email: row.email });
    res.json({ token, user: toPublicUser(row, `${req.protocol}://${req.get('host')}`) });
  } catch (err) {
    console.error('login failed:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const user = await findUserById(req.auth!.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user: toPublicUser(user, `${req.protocol}://${req.get('host')}`) });
  } catch (err) {
    console.error('me failed:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

router.patch('/me', requireAuth, async (req: AuthedRequest, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const { bio, xp, level, questsCompleted, username } = req.body ?? {};
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  let usernameChanged: string | null = null;

  if (typeof username === 'string') {
    const check = validateUsername(username);
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }

    const current = await findUserById(req.auth!.userId);
    if (current && current.username.toLowerCase() !== check.username.toLowerCase()) {
      const taken = await pool.query(
        `SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id <> $2`,
        [check.username, req.auth!.userId]
      );
      if (taken.rows.length > 0) {
        res.status(409).json({ error: 'Username is already taken' });
        return;
      }
      updates.push(`username = $${idx++}`);
      values.push(check.username);
      usernameChanged = check.username;
    }
  }

  if (typeof bio === 'string') {
    updates.push(`bio = $${idx++}`);
    values.push(bio.trim());
  }
  if (typeof xp === 'number') {
    updates.push(`xp = $${idx++}`);
    values.push(xp);
  }
  if (typeof level === 'number') {
    updates.push(`level = $${idx++}`);
    values.push(level);
  }
  if (typeof questsCompleted === 'number') {
    updates.push(`quests_completed = $${idx++}`);
    values.push(questsCompleted);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No valid fields to update' });
    return;
  }

  values.push(req.auth!.userId);

  try {
    const result = await pool.query<UserRow>(
      `UPDATE users SET ${updates.join(', ')}
       WHERE id = $${idx}
       RETURNING id, username, email, bio, xp, level, quests_completed, email_verified, avatar_url, created_at`,
      values
    );

    const user = result.rows[0];
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (usernameChanged) {
      await pool.query(`UPDATE quest_completions SET username = $1 WHERE user_id = $2`, [
        usernameChanged,
        req.auth!.userId,
      ]);
    }

    res.json({ user: toPublicUser(user, `${req.protocol}://${req.get('host')}`) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(message)) {
      res.status(409).json({ error: 'Username is already taken' });
      return;
    }
    console.error('patch me failed:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.post('/me/avatar', requireAuth, (req: AuthedRequest, res, next) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message || 'Invalid image file' });
      return;
    }
    next();
  });
}, async (req: AuthedRequest, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'avatar image is required' });
    return;
  }

  try {
    const avatarPath = isCloudinaryConfigured()
      ? await uploadLocalFile(req.file.path, 'avatars')
      : `/uploads/avatars/${req.file.filename}`;

    const current = await pool.query<{ avatar_url: string | null }>(
      `SELECT avatar_url FROM users WHERE id = $1`,
      [req.auth!.userId]
    );
    const previous = current.rows[0]?.avatar_url;

    const result = await pool.query<UserRow>(
      `UPDATE users SET avatar_url = $1
       WHERE id = $2
       RETURNING id, username, email, bio, xp, level, quests_completed, email_verified, avatar_url, created_at`,
      [avatarPath, req.auth!.userId]
    );

    const user = result.rows[0];
    if (!user) {
      fs.unlink(req.file.path, () => undefined);
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (previous?.startsWith('/uploads/avatars/')) {
      const oldPath = path.join(__dirname, '../..', previous);
      fs.unlink(oldPath, () => undefined);
    } else {
      await deleteCloudinaryAsset(previous);
    }

    res.json({ user: toPublicUser(user, `${req.protocol}://${req.get('host')}`) });
  } catch (err) {
    if (req.file) {
      fs.unlink(req.file.path, () => undefined);
    }
    console.error('avatar upload failed:', err);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

router.post('/verify-email', async (req, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const { token } = req.body ?? {};
  if (!token?.trim()) {
    res.status(400).json({ error: 'token is required' });
    return;
  }

  try {
    const result = await pool.query<UserRow>(
      `SELECT id, username, email, bio, xp, level, quests_completed, email_verified, avatar_url, created_at
       FROM users
       WHERE verification_token = $1
         AND verification_token_expires > NOW()`,
      [token.trim()]
    );

    const user = result.rows[0];
    if (!user) {
      res.status(400).json({ error: 'Invalid or expired verification link' });
      return;
    }

    const updated = await pool.query<UserRow>(
      `UPDATE users
       SET email_verified = TRUE, verification_token = NULL, verification_token_expires = NULL
       WHERE id = $1
       RETURNING id, username, email, bio, xp, level, quests_completed, email_verified, avatar_url, created_at`,
      [user.id]
    );

    res.json({ user: toPublicUser(updated.rows[0], `${req.protocol}://${req.get('host')}`) });
  } catch (err) {
    console.error('verify-email failed:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.post('/google', async (req, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  if (!isGoogleAuthConfigured()) {
    res.status(503).json({ error: 'Google sign-in is not configured' });
    return;
  }

  const { idToken, accessToken } = req.body ?? {};
  if (!idToken?.trim() && !accessToken?.trim()) {
    res.status(400).json({ error: 'idToken or accessToken is required' });
    return;
  }

  try {
    const profile = await resolveGoogleProfile(idToken, accessToken);

    const byGoogle = await pool.query<UserRow>(
      `SELECT id, username, email, bio, xp, level, quests_completed, email_verified, avatar_url, created_at
       FROM users WHERE google_id = $1`,
      [profile.googleId]
    );

    if (byGoogle.rows[0]) {
      const user = byGoogle.rows[0];
      const token = signAccessToken({ userId: user.id, email: user.email });
      res.json({ token, user: toPublicUser(user, `${req.protocol}://${req.get('host')}`) });
      return;
    }

    const byEmail = await pool.query<UserRow & { google_id: string | null }>(
      `SELECT id, username, email, bio, xp, level, quests_completed, email_verified, avatar_url, created_at, google_id
       FROM users WHERE LOWER(email) = LOWER($1)`,
      [profile.email]
    );

    if (byEmail.rows[0]) {
      const existing = byEmail.rows[0];
      if (existing.google_id && existing.google_id !== profile.googleId) {
        res.status(409).json({ error: 'Email is linked to a different Google account' });
        return;
      }

      const linked = await pool.query<UserRow>(
        `UPDATE users
         SET google_id = $1,
             email_verified = CASE WHEN $2 THEN TRUE ELSE email_verified END
         WHERE id = $3
         RETURNING id, username, email, bio, xp, level, quests_completed, email_verified, avatar_url, created_at`,
        [profile.googleId, profile.emailVerified, existing.id]
      );

      const user = linked.rows[0];
      const token = signAccessToken({ userId: user.id, email: user.email });
      res.json({ token, user: toPublicUser(user, `${req.protocol}://${req.get('host')}`) });
      return;
    }

    const username = await uniqueUsername(pool, profile.name);
    const insert = await pool.query<UserRow>(
      `INSERT INTO users (
        username, email, password_hash, bio, google_id, email_verified, avatar_url
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6)
      RETURNING id, username, email, bio, xp, level, quests_completed, email_verified, avatar_url, created_at`,
      [
        username,
        profile.email,
        'New adventurer on Side Quest',
        profile.googleId,
        profile.emailVerified,
        profile.picture ?? null,
      ]
    );

    const user = insert.rows[0];
    const token = signAccessToken({ userId: user.id, email: user.email });
    res.status(201).json({ token, user: toPublicUser(user, `${req.protocol}://${req.get('host')}`) });
  } catch (err) {
    console.error('google auth failed:', err);
    res.status(401).json({ error: googleAuthErrorMessage(err) });
  }
});

router.post('/resend-verification', requireAuth, async (req: AuthedRequest, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  try {
    const user = await findUserById(req.auth!.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (user.email_verified) {
      res.status(400).json({ error: 'Email is already verified' });
      return;
    }

    const verificationToken = generateVerificationToken();
    const tokenExpires = verificationExpiry();

    await pool.query(
      `UPDATE users SET verification_token = $1, verification_token_expires = $2 WHERE id = $3`,
      [verificationToken, tokenExpires, user.id]
    );

    const emailMeta = await sendVerificationEmail(user.email, user.username, verificationToken);
    res.json({ ok: true, emailVerification: emailMeta });
  } catch (err) {
    console.error('resend-verification failed:', err);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
});

export default router;
