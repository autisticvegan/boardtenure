-- Shares outstanding as reported on 10-K/10-Q cover pages (dei:EntityCommonStockSharesOutstanding),
-- summed across share classes. Used for an approximate market cap.
CREATE TABLE shares_outstanding (
  company_id          bigint NOT NULL REFERENCES company,
  as_of_date          date NOT NULL,
  shares              numeric(20, 0) NOT NULL CHECK (shares > 0),
  class_breakdown     jsonb NOT NULL DEFAULT '[]',   -- [{"class": "Class A", "shares": ...}]
  source_document_id  bigint NOT NULL REFERENCES source_document,
  PRIMARY KEY (company_id, as_of_date)
);
