-- Profile photo URL (uploaded file path or external URL e.g. Google)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;
