-- Quest proof completions (photos/videos on feed)

CREATE TABLE IF NOT EXISTS quest_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  quest_title TEXT NOT NULL,
  quest_category TEXT NOT NULL,
  quest_city TEXT NOT NULL,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'photo',
  vote_count INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, quest_id)
);

CREATE INDEX IF NOT EXISTS idx_quest_completions_user ON quest_completions (user_id);
CREATE INDEX IF NOT EXISTS idx_quest_completions_completed_at ON quest_completions (completed_at DESC);
