-- Run once against your Render Postgres:
-- psql "$DATABASE_URL" -f migrations/001_initial.sql

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  bio TEXT DEFAULT '',
  xp INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  quests_completed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- More tables will be added in the next phase (quests, completions, votes, achievements)
