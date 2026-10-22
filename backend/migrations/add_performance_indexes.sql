-- Speed up list, dashboard, attendance, and report-card queries.
-- Add QR columns first so barcode indexes do not fail on older schemas.
ALTER TABLE students ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE staffs ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE nonstaffs ADD COLUMN IF NOT EXISTS barcode TEXT;

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
    'CREATE INDEX IF NOT EXISTS idx_subjects_school ON subjects (school_id)',
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

CREATE OR REPLACE FUNCTION schooltype_performance_indexes_ready()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'ready', (
      SELECT COUNT(*) >= 8
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'idx_students_school_created',
          'idx_students_school_class',
          'idx_students_barcode',
          'idx_staffs_school_created',
          'idx_staffs_barcode',
          'idx_nonstaffs_school_created',
          'idx_nonstaffs_barcode',
          'idx_attendance_school_date',
          'idx_classes_school',
          'idx_subjects_school',
          'idx_student_scores_school_updated'
        )
    ),
    'found', (
      SELECT COALESCE(jsonb_agg(indexname ORDER BY indexname), '[]'::jsonb)
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname LIKE 'idx_%'
        AND tablename IN (
          'students', 'staffs', 'nonstaffs', 'attendance', 'messages',
          'classes', 'subjects', 'student_scores'
        )
    )
  );
$$;

GRANT EXECUTE ON FUNCTION schooltype_performance_indexes_ready() TO service_role, authenticated, anon;
