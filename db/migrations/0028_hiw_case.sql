-- Researched Heads I Win cases of newer kinds (golden hellos, layoffs beside CEO pay): a list of
-- figures per case, each verified against the quotes it cites.
CREATE TABLE hiw_case (
  id            text PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('golden_hello', 'layoffs')),
  company_name  text NOT NULL,
  company_cik   text,
  ticker        text,
  person_name   text,
  role          text,
  event_date    text,                 -- YYYY-MM-DD, YYYY-MM or YYYY
  headline      text NOT NULL,        -- the filing's own words where possible
  figures       jsonb NOT NULL,       -- [{key, label, value, unit, fiscal_year?}]
  notes         text,
  source_urls   text[] NOT NULL,
  evidence_ids  bigint[] NOT NULL,
  source_file   text NOT NULL
);
