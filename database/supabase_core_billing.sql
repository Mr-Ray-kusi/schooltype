-- Run in Supabase SQL editor.
-- Keeps schools, people, attendance, messages, subscriptions, wallets,
-- SMS units, and payment history on Postgres (Supabase).

-- ========== Schools: plans + subscriptions ==========
ALTER TABLE schools ADD COLUMN IF NOT EXISTS payment_plan TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS plan_status TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS plan_selected_at TIMESTAMPTZ;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS initial_password TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS scanner_token TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS next_payment_due DATE;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS last_payment_at DATE;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS subscription_frozen BOOLEAN DEFAULT FALSE;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS subscription_started_at DATE;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS total_paid NUMERIC DEFAULT 0;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT TRUE;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS email_verification_token TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_scanner_token
  ON schools (scanner_token)
  WHERE scanner_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_schools_email_verification_token
  ON schools (email_verification_token)
  WHERE email_verification_token IS NOT NULL;

-- ========== Subscription payment history ==========
CREATE TABLE IF NOT EXISTS subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  plan TEXT,
  plan_name TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'GHS',
  payment_reference TEXT,
  momo_phone TEXT,
  status TEXT DEFAULT 'approved',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by TEXT
);

ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS plan_name TEXT;

CREATE INDEX IF NOT EXISTS idx_subscription_payments_school
  ON subscription_payments (school_id, created_at DESC);

-- ========== Wallets ==========
CREATE TABLE IF NOT EXISTS school_wallets (
  school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  available_balance BIGINT NOT NULL DEFAULT 0,
  pending_balance BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'GHS',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  label TEXT,
  account_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  bank_code TEXT NOT NULL,
  bank_name TEXT,
  provider TEXT,
  currency TEXT NOT NULL DEFAULT 'GHS',
  paystack_recipient_code TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_accounts_school
  ON wallet_accounts (school_id);

ALTER TABLE wallet_accounts ADD COLUMN IF NOT EXISTS paystack_subaccount_code TEXT;

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount BIGINT NOT NULL,
  fee BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  channel TEXT,
  account_id UUID,
  reference TEXT UNIQUE NOT NULL,
  provider_reference TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_school
  ON wallet_transactions (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_reference
  ON wallet_transactions (reference);

-- ========== SMS units ==========
CREATE TABLE IF NOT EXISTS platform_sms_settings (
  id TEXT PRIMARY KEY,
  units_available BIGINT NOT NULL DEFAULT 0,
  unit_price_minor BIGINT NOT NULL DEFAULT 5,
  total_revenue_minor BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO platform_sms_settings (id, units_available, unit_price_minor, total_revenue_minor, updated_at)
VALUES ('platform', 0, 5, 0, NOW())
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS platform_sms_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  school_name TEXT,
  units BIGINT NOT NULL,
  amount_minor BIGINT NOT NULL DEFAULT 0,
  recipients_count BIGINT NOT NULL DEFAULT 0,
  segments BIGINT NOT NULL DEFAULT 0,
  reference TEXT UNIQUE NOT NULL,
  message_preview TEXT,
  sale_type TEXT NOT NULL DEFAULT 'broadcast',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_sales_school
  ON platform_sms_sales (school_id);
CREATE INDEX IF NOT EXISTS idx_sms_sales_created
  ON platform_sms_sales (created_at DESC);

CREATE TABLE IF NOT EXISTS school_sms_balances (
  school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  units_available BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- School fee collections (parents pay via Paystack: MoMo, bank, bank transfer / USSD)
CREATE TABLE IF NOT EXISTS fee_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  payer_type TEXT NOT NULL DEFAULT 'student',
  payer_id UUID,
  payer_name TEXT,
  payer_class TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  payment_method TEXT DEFAULT 'paystack',
  payment_month TEXT,
  payment_reference TEXT,
  status TEXT DEFAULT 'success',
  channel TEXT,
  currency TEXT DEFAULT 'GHS',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS payment_reference TEXT;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'success';
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS channel TEXT;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'GHS';
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS payer_class TEXT;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS recorded_by_role TEXT;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS recorded_by_staff_id UUID;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS recorded_by_name TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_payments_reference
  ON fee_payments (payment_reference)
  WHERE payment_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fee_payments_school_month
  ON fee_payments (school_id, payment_month, created_at DESC);

ALTER TABLE classes ADD COLUMN IF NOT EXISTS fee_amount NUMERIC DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS monthly_fee NUMERIC DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS fee_status TEXT DEFAULT 'unpaid';

CREATE TABLE IF NOT EXISTS academic_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 1,
  starts_on DATE,
  ends_on DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_academic_terms_school
  ON academic_terms (school_id, sort_order);

CREATE TABLE IF NOT EXISTS auth_rate_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  email TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_kind_email
  ON auth_rate_events (kind, email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_rate_kind_ip
  ON auth_rate_events (kind, ip, created_at DESC);

-- Unpaid registrations wait here until Paystack succeeds
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
