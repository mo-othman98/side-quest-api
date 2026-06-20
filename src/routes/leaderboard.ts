import { Router } from 'express';
import { pool } from '../db';

const router = Router();

const VALID_CITIES = new Set([
  'rabat',
  'new_york',
  'san_francisco',
  'bangkok',
  'london',
  'paris',
  'tokyo',
  'dubai',
  'singapore',
  'barcelona',
  'rome',
  'istanbul',
]);

const VALID_CATEGORIES = new Set([
  'discovery',
  'photography',
  'social',
  'sports',
  'food',
]);

interface LeaderboardRow {
  id: string;
  username: string;
  bio: string;
  xp: number;
  level: number;
  quests_completed: number;
  avatar_url: string | null;
}

function resolveAvatarUrl(avatarUrl: string | null, baseUrl: string): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith('http')) return avatarUrl;
  return `${baseUrl}${avatarUrl.startsWith('/') ? '' : '/'}${avatarUrl}`;
}

router.get('/', async (req, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const city = typeof req.query.city === 'string' && req.query.city ? req.query.city : null;
  const category =
    typeof req.query.category === 'string' && req.query.category ? req.query.category : null;

  if (city && !VALID_CITIES.has(city)) {
    res.status(400).json({ error: 'Invalid city filter' });
    return;
  }

  if (category && !VALID_CATEGORIES.has(category)) {
    res.status(400).json({ error: 'Invalid category filter' });
    return;
  }

  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    let result;

    if (city || category) {
      result = await pool.query<LeaderboardRow>(
        `SELECT DISTINCT u.id, u.username, u.bio, u.xp, u.level, u.quests_completed, u.avatar_url
         FROM users u
         INNER JOIN quest_completions qc ON qc.user_id = u.id
         WHERE ($1::text IS NULL OR qc.quest_city = $1)
           AND ($2::text IS NULL OR qc.quest_category = $2)
         ORDER BY u.xp DESC, u.username ASC
         LIMIT 100`,
        [city, category]
      );
    } else {
      result = await pool.query<LeaderboardRow>(
        `SELECT u.id, u.username, u.bio, u.xp, u.level, u.quests_completed, u.avatar_url
         FROM users u
         ORDER BY u.xp DESC, u.username ASC
         LIMIT 100`
      );
    }

    res.json({
      players: result.rows.map((row, index) => ({
        id: row.id,
        username: row.username,
        bio: row.bio,
        xp: row.xp,
        level: row.level,
        questsCompleted: row.quests_completed,
        avatarUrl: resolveAvatarUrl(row.avatar_url, baseUrl),
        rank: index + 1,
      })),
    });
  } catch (err) {
    console.error('leaderboard failed:', err);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

export default router;
