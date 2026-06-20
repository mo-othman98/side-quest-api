-- DM requests: players must approve before messaging

CREATE TABLE IF NOT EXISTS dm_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  CHECK (requester_id <> recipient_id),
  UNIQUE (requester_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_requests_recipient_pending
  ON dm_requests (recipient_id, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_dm_requests_requester
  ON dm_requests (requester_id, recipient_id);
