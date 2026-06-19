-- Quest ideas submitted by players (pending admin review)

CREATE TABLE IF NOT EXISTS quest_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  username TEXT,
  city_id TEXT NOT NULL,
  category TEXT NOT NULL,
  location_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quest_submissions_status ON quest_submissions (status);
CREATE INDEX IF NOT EXISTS idx_quest_submissions_created_at ON quest_submissions (created_at DESC);
