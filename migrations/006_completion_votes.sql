-- Per-user votes on quest completions

CREATE TABLE IF NOT EXISTS completion_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  completion_id UUID NOT NULL REFERENCES quest_completions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, completion_id)
);

CREATE INDEX IF NOT EXISTS idx_completion_votes_user ON completion_votes (user_id);
CREATE INDEX IF NOT EXISTS idx_completion_votes_completion ON completion_votes (completion_id);
