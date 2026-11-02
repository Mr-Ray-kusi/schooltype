-- Scanner device locks, staff single-device sessions, and a cache generation
-- that every API server watches. Without these, a second server would allow
-- a third scanner and keep serving data another server already changed.

CREATE TABLE IF NOT EXISTS scanner_slots (
  school_id UUID NOT NULL,
  device_id TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_scanner_slots_school_seen
  ON scanner_slots (school_id, last_seen_at);

CREATE TABLE IF NOT EXISTS staff_device_sessions (
  staff_id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS runtime_flags (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO runtime_flags (name, value)
VALUES ('cache_generation', '1')
ON CONFLICT (name) DO NOTHING;
