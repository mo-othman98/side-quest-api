import { Router } from 'express';
import bcrypt from 'bcrypt';
import { pool } from '../db';
import { AuthedRequest, requireAuth, signAccessToken } from '../middleware/auth';
import { generateVerificationToken, verificationExpiry } from '../utils/authTokens';
import { sendVerificationEmail } from '../services/emailService';
import { isGoogleAuthConfigured, verifyGoogleIdToken } from '../services/googleAuthService';
import { uniqueUsername } from '../utils/username';

const router = Router();
const BCRYPT_ROUNDS = 12;

interface UserRow {
  id: string;
  username: string;
  email: string;
  bio: string;
  xp: number;
  level: number;
  quests_completed: number;
  email_verified: boolean;
  created_at: string;
}

function toPublicUser(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    bio: row.bio,
    xp: row.xp,
    level: row.level,
    questsCompleted: row.quests_completed,
    emailVerified: row.email_verified,
  };
}

async function findUserByEmail(email: string): Promise<UserRow | null> {
  if (!pool) return null;
  const result = await pool.query<UserRow>(
    `SELECT id, username, email, bio, xp, level, quests_completed, email_verified, created_at
     FROM users WHERE LOWER(email) = LOWER($1)`,
    [email.trim()]
  );
  return result.rows[0] ?? null;
}

async function findUserById(id: string): Promise<UserRow | null> {
  if (!pool) return null;
  const result = await pool.query<UserRow>(
    `SELECT id, username, email, bio, xp, level, quests_completed, email_verified, created_at
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
      RETURNING id, username, email, bio, xp, level, quests_completed, email_verified, created_at`,
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
      user: toPublicUser(user),
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
      `SELECT id, username, email, password_hash, bio, xp, level, quests_completed, email_verified, created_at
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
    res.json({ token, user: toPublicUser(row) });
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
    res.json({ user: toPublicUser(user) });
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

  const { bio, xp, level, questsCompleted } = req.body ?? {};
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

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
       RETURNING id, username, email, bio, xp, level, quests_completed, email_verified, created_at`,
      values
    );

    const user = result.rows[0];
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user: toPublicUser(user) });
  } catch (err) {
    console.error('patch me failed:', err);
    res.status(500).json({ error: 'Failed to update profile' });
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
      `SELECT id, username, email, bio, xp, level, quests_completed, email_verified, created_at
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
       RETURNING id, username, email, bio, xp, level, quests_completed, email_verified, created_at`,
      [user.id]
    );

    res.json({ user: toPublicUser(updated.rows[0]) });
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

  const { idToken } = req.body ?? {};
  if (!idToken?.trim()) {
    res.status(400).json({ error: 'idToken is required' });
    return;
  }

  try {
    const profile = await verifyGoogleIdToken(idToken.trim());

    const byGoogle = await pool.query<UserRow>(
      `SELECT id, username, email, bio, xp, level, quests_completed, email_verified, created_at
       FROM users WHERE google_id = $1`,
      [profile.googleId]
    );

    if (byGoogle.rows[0]) {
      const user = byGoogle.rows[0];
      const token = signAccessToken({ userId: user.id, email: user.email });
      res.json({ token, user: toPublicUser(user) });
      return;
    }

    const byEmail = await pool.query<UserRow & { google_id: string | null }>(
      `SELECT id, username, email, bio, xp, level, quests_completed, email_verified, created_at, google_id
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
         RETURNING id, username, email, bio, xp, level, quests_completed, email_verified, created_at`,
        [profile.googleId, profile.emailVerified, existing.id]
      );

      const user = linked.rows[0];
      const token = signAccessToken({ userId: user.id, email: user.email });
      res.json({ token, user: toPublicUser(user) });
      return;
    }

    const username = await uniqueUsername(pool, profile.name);
    const insert = await pool.query<UserRow>(
      `INSERT INTO users (
        username, email, password_hash, bio, google_id, email_verified
      ) VALUES ($1, $2, NULL, $3, $4, $5)
      RETURNING id, username, email, bio, xp, level, quests_completed, email_verified, created_at`,
      [
        username,
        profile.email,
        'New adventurer on Side Quest',
        profile.googleId,
        profile.emailVerified,
      ]
    );

    const user = insert.rows[0];
    const token = signAccessToken({ userId: user.id, email: user.email });
    res.status(201).json({ token, user: toPublicUser(user) });
  } catch (err) {
    console.error('google auth failed:', err);
    res.status(401).json({ error: 'Google sign-in failed' });
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
