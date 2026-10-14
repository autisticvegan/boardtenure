-- What each tracked executive sold (Form 4 code S) during their officer tenure, in today's share
-- units, and what the same shares were worth at the end of the tenure window.
CREATE TABLE executive_sales (
  company_id        bigint NOT NULL REFERENCES company,
  person_id         bigint NOT NULL REFERENCES person,
  window_start      date NOT NULL,
  window_end        date NOT NULL,
  sales             integer NOT NULL,           -- transaction lines
  filings           integer NOT NULL,
  shares_sold_adj   numeric(24, 4) NOT NULL,    -- split-adjusted to the latest share basis
  proceeds          numeric(20, 2) NOT NULL,
  avg_price_adj     double precision,
  end_close_adj     double precision,
  value_at_end      numeric(20, 2),
  plan_share        double precision,           -- share of proceeds from filings marked 10b5-1
  methodology_version text NOT NULL,
  PRIMARY KEY (company_id, person_id)
);
