ALTER TABLE students ADD COLUMN IF NOT EXISTS alumni_year INTEGER;
ALTER TABLE students ADD COLUMN IF NOT EXISTS alumni_class TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS alumni_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_students_school_alumni_year
  ON students (school_id, alumni_year);
