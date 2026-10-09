-- Screened companies whose proxy has been fetched and checked: the CEO names tagged in the
-- pay-versus-performance table, and whether every frame value we show is in that filing.
CREATE TABLE pvp_case (
  cik            bigint PRIMARY KEY,
  accession      text NOT NULL,
  doc_url        text NOT NULL,
  peo_names      text[] NOT NULL DEFAULT '{}',
  verified       boolean NOT NULL,
  checked_facts  integer NOT NULL,
  mismatches     jsonb NOT NULL DEFAULT '[]',
  checked_at     timestamptz NOT NULL DEFAULT now()
);
