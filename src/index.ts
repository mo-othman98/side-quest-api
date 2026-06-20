import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { pool } from './db';
import authRouter from './routes/auth';
import completionsRouter from './routes/completions';
import { getGoogleAuthStatus } from './services/googleAuthService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

const VALID_CATEGORIES = new Set([
  'discovery',
  'photography',
  'social',
  'sports',
  'food',
]);

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'side-quest-api',
    database: !!pool,
    auth: !!process.env.JWT_SECRET,
    googleAuth: !!process.env.GOOGLE_CLIENT_ID,
    google: getGoogleAuthStatus(),
  });
});

app.use('/auth', authRouter);
app.use('/completions', completionsRouter);

app.post('/quest-submissions', async (req, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const { title, description, locationName, city, category, username, userId } = req.body ?? {};

  if (!title?.trim() || !description?.trim() || !locationName?.trim() || !city || !category) {
    res.status(400).json({ error: 'title, description, locationName, city, and category are required' });
    return;
  }

  if (!VALID_CATEGORIES.has(category)) {
    res.status(400).json({ error: 'Invalid quest category' });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO quest_submissions
        (user_id, username, city_id, category, location_name, title, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING id, status`,
      [
        userId ?? null,
        username ?? null,
        city,
        category,
        locationName.trim(),
        title.trim(),
        description.trim(),
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('quest-submissions insert failed:', err);
    res.status(500).json({ error: 'Failed to save quest submission' });
  }
});

app.get('/quest-submissions', async (req, res) => {
  if (!pool) {
    res.status(503).json({ error: 'Database not configured' });
    return;
  }

  const adminKey = req.header('x-admin-key');
  if (!ADMIN_API_KEY || adminKey !== ADMIN_API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const status = (req.query.status as string) || 'pending';

  try {
    const result = await pool.query(
      `SELECT id, user_id, username, city_id, category, location_name, title, description, status, created_at
       FROM quest_submissions
       WHERE status = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [status]
    );
    res.json({ submissions: result.rows });
  } catch (err) {
    console.error('quest-submissions list failed:', err);
    res.status(500).json({ error: 'Failed to load submissions' });
  }
});

app.listen(PORT, () => {
  console.log(`Side Quest API running on port ${PORT}`);
});
