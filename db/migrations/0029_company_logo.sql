-- Company icons for display, keyed by SEC CIK. Image files live in the raw store
-- (data/raw/logos/, not committed); this records where each came from.
CREATE TABLE company_logo (
  cik           bigint PRIMARY KEY,
  name          text,
  website       text,                 -- official website (Wikidata P856)
  source        text NOT NULL CHECK (source IN ('favicon', 'commons', 'none')),
  source_url    text,
  file          text,                 -- name under data/raw/logos/
  content_type  text,
  width         integer,
  fetched_at    timestamptz NOT NULL DEFAULT now()
);
