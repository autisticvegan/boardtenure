-- The research files carry both companies' CIKs (tickers of delisted companies don't resolve).
ALTER TABLE failing_up_case ADD COLUMN from_cik bigint, ADD COLUMN to_cik bigint;
