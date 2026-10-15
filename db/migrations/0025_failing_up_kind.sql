-- Failing-up cases now come from several research files, and the next role can be a board seat
-- (paid from the Director Compensation table) as well as an executive job.
ALTER TABLE failing_up_case ADD COLUMN to_kind text NOT NULL DEFAULT 'executive'
  CHECK (to_kind IN ('executive', 'director'));
ALTER TABLE failing_up_case ADD COLUMN source_file text;
