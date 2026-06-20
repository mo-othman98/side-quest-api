import { Router } from 'express';
import { pool } from '../db';

const router = Router();

function resolveAvatarUrl(avatarUrl: string | null, baseUrl: string): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith('http')) return avatarUrl;
  return `${baseUrl}${avatarUrl.startsWith('/') ? '' : '/'}${avatarUrl}`;
}

router.get('/:id', async (req, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  try {
    const result = await pool.query<{
      id: string;
      username: string;
      bio: string;
      xp: number;
      level: number;
      quests_completed: number;
      avatar_url: string | null;
    }>(
      `SELECT id, username, bio, xp, level, quests_completed, avatar_url
       FROM users WHERE id = $1`,
      [req.params.id]
    );

    const user = result.rows[0];
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      user: {
        id: user.id,
        username: user.username,
        bio: user.bio,
        xp: user.xp,
        level: user.level,
        questsCompleted: user.quests_completed,
        avatarUrl: resolveAvatarUrl(user.avatar_url, baseUrl),
      },
    });
  } catch (err) {
    console.error('public user profile failed:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

export default router;
