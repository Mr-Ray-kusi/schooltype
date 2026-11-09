-- School-edited SMS wording for absence and fee reminders.
-- Run in the Supabase SQL editor. The API also adds these columns at boot.

ALTER TABLE schools ADD COLUMN IF NOT EXISTS absent_sms_template TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS owing_sms_template TEXT;
