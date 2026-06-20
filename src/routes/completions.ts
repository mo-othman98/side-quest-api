import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { pool } from '../db';
import { AuthedRequest, optionalAuth, requireAuth } from '../middleware/auth';

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
  has_voted?: boolean;
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
    hasVoted: !!row.has_voted,
    completedAt: row.completed_at,
  };
}

const COMPLETION_COLUMNS = `qc.id, qc.user_id, qc.username, qc.quest_id, qc.quest_title, qc.quest_category, qc.quest_city,
              qc.xp_earned, qc.media_url, qc.media_type, qc.vote_count, qc.completed_at`;

router.get('/feed', optionalAuth, async (req: AuthedRequest, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10) || 100, 200);
  const voterId = req.auth?.userId ?? null;

  try {
    const result = voterId
      ? await pool.query<CompletionRow>(
          `SELECT ${COMPLETION_COLUMNS},
                  EXISTS(
                    SELECT 1 FROM completion_votes cv
                    WHERE cv.completion_id = qc.id AND cv.user_id = $1
                  ) AS has_voted
           FROM quest_completions qc
           ORDER BY qc.completed_at DESC
           LIMIT $2`,
          [voterId, limit]
        )
      : await pool.query<CompletionRow>(
          `SELECT ${COMPLETION_COLUMNS}, false AS has_voted
           FROM quest_completions qc
           ORDER BY qc.completed_at DESC
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
    const userId = req.auth!.userId;
    const result = await pool.query<CompletionRow>(
      `SELECT ${COMPLETION_COLUMNS},
              EXISTS(
                SELECT 1 FROM completion_votes cv
                WHERE cv.completion_id = qc.id AND cv.user_id = $1
              ) AS has_voted
       FROM quest_completions qc
       WHERE qc.user_id = $2
       ORDER BY qc.completed_at DESC`,
      [userId, userId]
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

router.post('/:id/vote', requireAuth, async (req: AuthedRequest, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const completionId = req.params.id;
  const userId = req.auth!.userId;

  try {
    const completionResult = await pool.query<{ user_id: string; vote_count: number }>(
      `SELECT user_id, vote_count FROM quest_completions WHERE id = $1`,
      [completionId]
    );
    const completion = completionResult.rows[0];
    if (!completion) {
      res.status(404).json({ error: 'Completion not found' });
      return;
    }

    if (completion.user_id === userId) {
      res.status(400).json({ error: 'You cannot vote on your own completion' });
      return;
    }

    const existingVote = await pool.query(
      `SELECT id FROM completion_votes WHERE user_id = $1 AND completion_id = $2`,
      [userId, completionId]
    );

    if (existingVote.rows.length > 0) {
      await pool.query(
        `DELETE FROM completion_votes WHERE user_id = $1 AND completion_id = $2`,
        [userId, completionId]
      );
      const updated = await pool.query<{ vote_count: number }>(
        `UPDATE quest_completions
         SET vote_count = GREATEST(vote_count - 1, 0)
         WHERE id = $1
         RETURNING vote_count`,
        [completionId]
      );

      res.json({
        hasVoted: false,
        voteCount: updated.rows[0]?.vote_count ?? Math.max(completion.vote_count - 1, 0),
      });
      return;
    }

    await pool.query(
      `INSERT INTO completion_votes (user_id, completion_id) VALUES ($1, $2)`,
      [userId, completionId]
    );
    const updated = await pool.query<{ vote_count: number }>(
      `UPDATE quest_completions
       SET vote_count = vote_count + 1
       WHERE id = $1
       RETURNING vote_count`,
      [completionId]
    );

    res.json({
      hasVoted: true,
      voteCount: updated.rows[0]?.vote_count ?? completion.vote_count + 1,
    });
  } catch (err) {
    console.error('completion vote failed:', err);
    res.status(500).json({ error: 'Failed to save vote' });
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
