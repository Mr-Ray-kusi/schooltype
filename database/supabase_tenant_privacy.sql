-- Privacy wall + durable stores. Run after supabase_core_billing.sql.
-- Day-to-day school traffic should use the anon key + a JWT that carries school_id.
-- Signup, plan changes, and the Paystack webhook keep using the service role.

-- ========== Durable extras (photos, sessions, audit) ==========
CREATE TABLE IF NOT EXISTS person_photos (
  person_id UUID PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_person_photos_school ON person_photos (school_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  remember BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_school ON auth_sessions (school_id, revoked_at);

CREATE TABLE IF NOT EXISTS platform_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_school_id UUID REFERENCES schools(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_school_id UUID,
  detail JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON platform_audit_log (created_at DESC);

CREATE TABLE IF NOT EXISTS withdrawal_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  reference TEXT NOT NULL UNIQUE,
  amount_minor BIGINT NOT NULL,
  account_id UUID,
  requested_by TEXT,
  confirmed_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

ALTER TABLE schools ADD COLUMN IF NOT EXISTS name_slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_schools_name_slug
  ON schools (name_slug)
  WHERE name_slug IS NOT NULL;

-- Searches people actually type
CREATE INDEX IF NOT EXISTS idx_students_school_name ON students (school_id, name);
CREATE INDEX IF NOT EXISTS idx_students_school_fee_status ON students (school_id, fee_status);
CREATE INDEX IF NOT EXISTS idx_students_school_barcode ON students (school_id, barcode);
CREATE INDEX IF NOT EXISTS idx_students_school_class ON students (school_id, class);
CREATE INDEX IF NOT EXISTS idx_staffs_school_barcode ON staffs (school_id, barcode);
CREATE INDEX IF NOT EXISTS idx_nonstaffs_school_barcode ON nonstaffs (school_id, barcode);

-- ========== Helper ==========
CREATE OR REPLACE FUNCTION public.jwt_school_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(auth.jwt() ->> 'school_id', '')
$$;

CREATE OR REPLACE FUNCTION public.jwt_is_platform()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(auth.jwt() ->> 'role', '') IN ('service_role', 'super_admin')
$$;

-- ========== Enable RLS ==========
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'schools',
    'students',
    'staffs',
    'nonstaffs',
    'attendance',
    'messages',
    'classes',
    'subjects',
    'class_fees',
    'academic_terms',
    'report_cards',
    'student_scores',
    'fee_payments',
    'subscription_payments',
    'school_wallets',
    'wallet_accounts',
    'wallet_transactions',
    'school_sms_balances',
    'person_photos',
    'auth_sessions',
    'withdrawal_approvals',
    'platform_notifications'
  ]
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXCEPTION
      WHEN undefined_table THEN
        RAISE NOTICE 'Skipping missing table %', t;
    END;
  END LOOP;
END $$;

-- Platform-only tables: no authenticated school access
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pending_signups',
    'platform_sms_settings',
    'platform_sms_sales',
    'platform_audit_log',
    'platform_events',
    'auth_rate_events'
  ]
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXCEPTION
      WHEN undefined_table THEN
        RAISE NOTICE 'Skipping missing table %', t;
    END;
  END LOOP;
END $$;

-- Drop leftover open policies if any, then recreate isolation policies.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- Schools: a tenant may only see itself
DROP POLICY IF EXISTS schools_self ON schools;
CREATE POLICY schools_self ON schools
  FOR ALL TO authenticated
  USING (id::text = public.jwt_school_id())
  WITH CHECK (id::text = public.jwt_school_id());

-- Generic school_id tables
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'students',
    'staffs',
    'nonstaffs',
    'attendance',
    'messages',
    'classes',
    'subjects',
    'class_fees',
    'academic_terms',
    'report_cards',
    'student_scores',
    'fee_payments',
    'subscription_payments',
    'school_wallets',
    'wallet_accounts',
    'wallet_transactions',
    'school_sms_balances',
    'person_photos',
    'auth_sessions',
    'withdrawal_approvals',
    'platform_notifications'
  ]
  LOOP
    BEGIN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL TO authenticated USING (school_id::text = public.jwt_school_id()) WITH CHECK (school_id::text = public.jwt_school_id())',
        t || '_tenant',
        t
      );
    EXCEPTION
      WHEN undefined_table THEN
        RAISE NOTICE 'Skipping policy on missing table %', t;
      WHEN duplicate_object THEN
        NULL;
    END;
  END LOOP;
END $$;

-- Service role (webhook / signup / cron) bypasses RLS by default in Supabase.
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

-- Anon cannot read tenant rows; public ID goes through the Express gate.
REVOKE ALL ON students, staffs, nonstaffs, fee_payments, schools FROM anon;
