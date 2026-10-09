-- Board cost per company and fiscal year (non-employee directors' Director Compensation table
-- totals, newest filing), beside the stock in that fiscal year and the one before.
CREATE TABLE board_pay_year (
  company_id            bigint NOT NULL REFERENCES company,
  fiscal_year           smallint NOT NULL,
  fiscal_year_end       date NOT NULL,
  directors_listed      integer NOT NULL,
  directors_paid        integer NOT NULL,
  board_total           numeric(18, 0) NOT NULL,
  median_paid           numeric(16, 0),
  start_market_cap      numeric(20, 0),
  pay_share_of_mcap     double precision,       -- board_total / start_market_cap
  status                text NOT NULL,
  total_return          double precision,       -- the stock over this fiscal year
  bench_total_return    double precision,
  relative_return_pp    double precision,
  prior_relative_pp     double precision,       -- the previous fiscal year, when pay for this year was set
  methodology_version   text NOT NULL,
  PRIMARY KEY (company_id, fiscal_year)
);
