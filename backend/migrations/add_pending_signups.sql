-- Hold unpaid registrations until Paystack succeeds. No schools row is created before payment.
CREATE TABLE IF NOT EXISTS pending_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  school_name TEXT NOT NULL,
  logo_url TEXT,
  payment_plan TEXT NOT NULL,
  google_signup BOOLEAN DEFAULT FALSE,
  paystack_reference TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'pending',
  school_id UUID REFERENCES schools(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  fulfilled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_signups_email_status
  ON pending_signups (email, status);

CREATE INDEX IF NOT EXISTS idx_pending_signups_reference
  ON pending_signups (paystack_reference);

ALTER TABLE IF EXISTS pending_signups DISABLE ROW LEVEL SECURITY;
