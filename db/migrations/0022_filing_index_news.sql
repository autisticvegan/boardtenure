-- Every filing's form, date and 8-K items for tracked companies (from EDGAR submissions), so the
-- event study can flag board changes announced alongside other news.
CREATE TABLE filing_index (
  cik          bigint NOT NULL,
  accession    text NOT NULL,
  form         text NOT NULL,
  filing_date  date NOT NULL,
  items        text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (cik, accession)
);
CREATE INDEX filing_index_date ON filing_index (cik, filing_date);

ALTER TABLE director_event ADD COLUMN near_earnings boolean NOT NULL DEFAULT false;
ALTER TABLE director_event ADD COLUMN other_news boolean NOT NULL DEFAULT false;
