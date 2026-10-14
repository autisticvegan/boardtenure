-- Transactions reported on Forms 4/5 by tracked executives (non-derivative table only: shares of
-- the issuer's stock). code S = open-market or private sale; proceeds = shares x price.
CREATE TABLE insider_transaction (
  accession          text NOT NULL,
  line               integer NOT NULL,           -- position in the filing's nonDerivativeTable
  form               text NOT NULL,
  issuer_cik         bigint NOT NULL,
  owner_cik          bigint NOT NULL,
  person_id          bigint REFERENCES person,
  company_id         bigint REFERENCES company,
  transaction_date   date NOT NULL,
  code               text NOT NULL,
  acquired_disposed  text,                        -- A or D
  shares             numeric(20, 4) NOT NULL,
  price              numeric(18, 6),
  shares_after       numeric(20, 4),
  direct_indirect    text,
  security_title     text,
  under_10b5_1       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (accession, line)
);
CREATE INDEX insider_transaction_person ON insider_transaction (company_id, person_id, transaction_date);
