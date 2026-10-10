-- Run this in your Supabase SQL editor to enable all new features
-- Extend schools table

ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS subscription_plan TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'pending';
ALTER TABLE schools ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS ussd_code TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS sms_count_month INT DEFAULT 0;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS sms_month_reset TEXT;

-- Extend students
ALTER TABLE students ADD COLUMN IF NOT EXISTS parent_phone TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS house_address TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS monthly_fee NUMERIC DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS fee_status TEXT DEFAULT 'unpaid';
ALTER TABLE students ADD COLUMN IF NOT EXISTS skills TEXT;

-- Subscription payments (school pays platform)
CREATE TABLE IF NOT EXISTS subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT DEFAULT 'GHS',
  payment_reference TEXT,
  momo_phone TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by TEXT
);

-- Fee payments (parents pay school)
CREATE TABLE IF NOT EXISTS fee_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  payer_type TEXT NOT NULL,
  payer_id UUID,
  payer_name TEXT,
  payer_class TEXT,
  amount NUMERIC NOT NULL,
  payment_method TEXT DEFAULT 'cash',
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
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS recorded_by_role TEXT;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS recorded_by_staff_id UUID;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS recorded_by_name TEXT;

-- Report card uploads
CREATE TABLE IF NOT EXISTS report_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  teacher_name TEXT,
  class_name TEXT,
  course TEXT,
  title TEXT,
  file_name TEXT,
  status TEXT DEFAULT 'Pending',
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Classes
CREATE TABLE IF NOT EXISTS classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  fee_amount NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE classes ADD COLUMN IF NOT EXISTS capacity INTEGER;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS form TEXT;

CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subjects_school ON subjects (school_id);

-- QR / attendance IDs (index creation below requires these columns)
ALTER TABLE students ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS qr_code TEXT;
ALTER TABLE staffs ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE staffs ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE staffs ADD COLUMN IF NOT EXISTS qr_code TEXT;
ALTER TABLE staffs ADD COLUMN IF NOT EXISTS salary NUMERIC;
ALTER TABLE nonstaffs ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE nonstaffs ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE nonstaffs ADD COLUMN IF NOT EXISTS qr_code TEXT;
ALTER TABLE nonstaffs ADD COLUMN IF NOT EXISTS salary NUMERIC;

DO $$
BEGIN
  BEGIN
    ALTER TABLE students ALTER COLUMN qr_code DROP NOT NULL;
  EXCEPTION
    WHEN undefined_column THEN NULL;
    WHEN others THEN NULL;
  END;
  BEGIN
    ALTER TABLE staffs ALTER COLUMN qr_code DROP NOT NULL;
  EXCEPTION
    WHEN undefined_column THEN NULL;
    WHEN others THEN NULL;
  END;
  BEGIN
    ALTER TABLE nonstaffs ALTER COLUMN qr_code DROP NOT NULL;
  EXCEPTION
    WHEN undefined_column THEN NULL;
    WHEN others THEN NULL;
  END;
END $$;

-- Speed up list, dashboard, attendance, and report-card queries.
-- Skip any index whose table or column is not in this database yet.
DO $$
DECLARE
  stmts text[] := ARRAY[
    'CREATE INDEX IF NOT EXISTS idx_students_school_created ON students (school_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_students_school_class ON students (school_id, class)',
    'CREATE INDEX IF NOT EXISTS idx_students_barcode ON students (barcode)',
    'CREATE INDEX IF NOT EXISTS idx_staffs_school_created ON staffs (school_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_staffs_barcode ON staffs (barcode)',
    'CREATE INDEX IF NOT EXISTS idx_nonstaffs_school_created ON nonstaffs (school_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_nonstaffs_barcode ON nonstaffs (barcode)',
    'CREATE INDEX IF NOT EXISTS idx_attendance_school_date ON attendance (school_id, date)',
    'CREATE INDEX IF NOT EXISTS idx_messages_school_reply ON messages (school_id, reply)',
    'CREATE INDEX IF NOT EXISTS idx_classes_school ON classes (school_id)',
    'CREATE INDEX IF NOT EXISTS idx_student_scores_school_updated ON student_scores (school_id, updated_at DESC)'
  ];
  stmt text;
BEGIN
  FOREACH stmt IN ARRAY stmts LOOP
    BEGIN
      EXECUTE stmt;
    EXCEPTION
      WHEN undefined_table OR undefined_column THEN
        RAISE NOTICE 'Skipping index (missing table/column): %', stmt;
    END;
  END LOOP;
END $$;

-- Class fee defaults for USSD
CREATE TABLE IF NOT EXISTS class_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  class_name TEXT NOT NULL,
  fee_amount NUMERIC NOT NULL DEFAULT 0
);

-- Super-admin analytics: who is online, logins, page visits, slow pages, errors
CREATE TABLE IF NOT EXISTS platform_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id) ON DELETE SET NULL,
  school_name TEXT,
  email TEXT,
  role TEXT,
  event_type TEXT NOT NULL,
  path TEXT,
  duration_ms INTEGER,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_events_created
  ON platform_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_events_type_created
  ON platform_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_events_school_created
  ON platform_events (school_id, created_at DESC);

ALTER TABLE IF EXISTS platform_events DISABLE ROW LEVEL SECURITY;

ALTER TABLE wallet_accounts ADD COLUMN IF NOT EXISTS paystack_subaccount_code TEXT;

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

ALTER TABLE IF EXISTS academic_terms DISABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS platform_notifications
  ADD COLUMN IF NOT EXISTS from_school_id UUID REFERENCES schools(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_platform_notifications_from_school
  ON platform_notifications (from_school_id, created_at DESC);

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

ALTER TABLE IF EXISTS pending_signups DISABLE ROW LEVEL SECURITY;
