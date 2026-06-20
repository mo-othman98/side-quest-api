import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { pool } from '../db';
import { AuthedRequest, requireAuth } from '../middleware/auth';

const router = Router();

const uploadsDir = path.join(__dirname, '../../uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || (file.mimetype?.includes('video') ? '.mp4' : '.jpg');
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
});

const VALID_CATEGORIES = new Set(['discovery', 'photography', 'social', 'sports', 'food']);

interface CompletionRow {
  id: string;
  user_id: string;
  username: string;
  quest_id: string;
  quest_title: string;
  quest_category: string;
  quest_city: string;
  xp_earned: number;
  media_url: string;
  media_type: string;
  vote_count: number;
  completed_at: string;
}

function toPublicCompletion(row: CompletionRow, baseUrl: string) {
  const mediaPath = row.media_url.startsWith('http')
    ? row.media_url
    : `${baseUrl}${row.media_url.startsWith('/') ? '' : '/'}${row.media_url}`;

  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    questId: row.quest_id,
    questTitle: row.quest_title,
    questCategory: row.quest_category,
    questCity: row.quest_city,
    xpEarned: row.xp_earned,
    mediaUrl: mediaPath,
    mediaType: row.media_type as 'photo' | 'video',
    voteCount: row.vote_count,
    hasVoted: false,
    completedAt: row.completed_at,
  };
}

router.get('/feed', async (req, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10) || 100, 200);

  try {
    const result = await pool.query<CompletionRow>(
      `SELECT id, user_id, username, quest_id, quest_title, quest_category, quest_city,
              xp_earned, media_url, media_type, vote_count, completed_at
       FROM quest_completions
       ORDER BY completed_at DESC
       LIMIT $1`,
      [limit]
    );

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      completions: result.rows.map((row) => toPublicCompletion(row, baseUrl)),
    });
  } catch (err) {
    console.error('completions feed failed:', err);
    res.status(500).json({ error: 'Failed to load feed' });
  }
});

router.get('/me', requireAuth, async (req: AuthedRequest, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  try {
    const result = await pool.query<CompletionRow>(
      `SELECT id, user_id, username, quest_id, quest_title, quest_category, quest_city,
              xp_earned, media_url, media_type, vote_count, completed_at
       FROM quest_completions
       WHERE user_id = $1
       ORDER BY completed_at DESC`,
      [req.auth!.userId]
    );

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const completions = result.rows.map((row) => toPublicCompletion(row, baseUrl));
    res.json({
      completions,
      completedQuestIds: completions.map((c) => c.questId),
    });
  } catch (err) {
    console.error('completions me failed:', err);
    res.status(500).json({ error: 'Failed to load your completions' });
  }
});

router.post('/', requireAuth, upload.single('proof'), async (req: AuthedRequest, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'proof file is required' });
    return;
  }

  const {
    questId,
    questTitle,
    questCategory,
    questCity,
    xpEarned,
    mediaType,
  } = req.body ?? {};

  if (!questId?.trim() || !questTitle?.trim() || !questCategory || !questCity) {
    res.status(400).json({ error: 'questId, questTitle, questCategory, and questCity are required' });
    return;
  }

  if (!VALID_CATEGORIES.has(questCategory)) {
    res.status(400).json({ error: 'Invalid quest category' });
    return;
  }

  const xp = parseInt(String(xpEarned ?? '0'), 10) || 0;
  const type = mediaType === 'video' ? 'video' : 'photo';
  const mediaPath = `/uploads/${req.file.filename}`;

  try {
    const userResult = await pool.query<{ username: string; xp: number; quests_completed: number }>(
      `SELECT username, xp, quests_completed FROM users WHERE id = $1`,
      [req.auth!.userId]
    );
    const userRow = userResult.rows[0];
    if (!userRow) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const insert = await pool.query<CompletionRow>(
      `INSERT INTO quest_completions (
        user_id, username, quest_id, quest_title, quest_category, quest_city,
        xp_earned, media_url, media_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, user_id, username, quest_id, quest_title, quest_category, quest_city,
                xp_earned, media_url, media_type, vote_count, completed_at`,
      [
        req.auth!.userId,
        userRow.username,
        questId.trim(),
        questTitle.trim(),
        questCategory,
        questCity,
        xp,
        mediaPath,
        type,
      ]
    );

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.status(201).json({ completion: toPublicCompletion(insert.rows[0], baseUrl) });
  } catch (err) {
    if (req.file) {
      fs.unlink(req.file.path, () => undefined);
    }

    const message = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(message)) {
      res.status(409).json({ error: 'You already completed this quest' });
      return;
    }

    console.error('completion insert failed:', err);
    res.status(500).json({ error: 'Failed to save completion' });
  }
});

export default router;
