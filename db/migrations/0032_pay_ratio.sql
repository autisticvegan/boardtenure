-- CEO pay ratio (Item 402(u)) from each screened company's latest proxy. A ratio counts as verified
-- when CEO pay and median employee pay printed in the same passage reproduce it.
CREATE TABLE pay_ratio (
  cik             bigint PRIMARY KEY,
  accession       text NOT NULL,
  doc_url         text NOT NULL,
  fiscal_year     integer,              -- the year the passage is about
  ratio           double precision NOT NULL,
  ceo_pay         numeric(18, 2),
  median_pay      numeric(18, 2),
  verified        boolean NOT NULL,
  quote           text NOT NULL,          -- the passage, verbatim from the document text
  extracted_at    timestamptz NOT NULL DEFAULT now()
);
