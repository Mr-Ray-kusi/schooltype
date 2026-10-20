-- Drop stored student, staff, and non-staff portraits.
-- School logos (schools.logo_url) stay in place.
DELETE FROM person_photos;
UPDATE students SET photo_url = NULL WHERE photo_url IS NOT NULL;
UPDATE staffs SET photo_url = NULL WHERE photo_url IS NOT NULL;
UPDATE nonstaffs SET photo_url = NULL WHERE photo_url IS NOT NULL;
