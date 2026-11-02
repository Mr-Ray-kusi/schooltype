-- Student results portal. The API also creates these tables on boot when
-- SUPABASE_DB_URL is set. Run this in the Supabase SQL editor if boot cannot.

CREATE TABLE IF NOT EXISTS school_student_portals (
  school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_portal_secrets (
  student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_enc TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_portal_secrets_school
  ON student_portal_secrets (school_id);
