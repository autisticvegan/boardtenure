-- Executive pay across companies: real fiscal-year ends on PvP rows, a company-level pay window,
-- and a latest-row rule that skips a newer filing whose own components don't add up (a typo).

ALTER TABLE pay_vs_performance ADD COLUMN fiscal_year_end date;

DROP VIEW pay_vs_performance_latest;
CREATE VIEW pay_vs_performance_latest AS
SELECT DISTINCT ON (p.company_id, p.fiscal_year) p.*, sd.published_at AS filed_on, sd.url AS source_url
FROM pay_vs_performance p
JOIN source_document sd ON sd.id = p.source_document_id
ORDER BY p.company_id, p.fiscal_year, sd.published_at DESC;

CREATE OR REPLACE VIEW executive_comp_latest AS
SELECT DISTINCT ON (ec.company_id, ec.person_id, ec.fiscal_year)
       ec.*, sd.published_at AS filed_on, sd.url AS source_url, sd.doc_type AS source_form
FROM executive_comp ec
JOIN source_document sd ON sd.id = ec.source_document_id
ORDER BY ec.company_id, ec.person_id, ec.fiscal_year,
         abs(ec.salary + ec.bonus + ec.stock_awards + ec.option_awards + ec.non_equity_incentive
             + ec.pension_nqdc + ec.all_other - ec.total) <= 1 DESC,
         sd.published_at DESC, ec.id DESC;

-- One row per company: every fiscal year with counted executive pay (after listing), the stock
-- against the benchmark from the start of the first such year to the end of the last.
CREATE TABLE company_pay_performance (
  company_id          bigint NOT NULL REFERENCES company,
  benchmark_id        smallint NOT NULL REFERENCES benchmark,
  first_pay_year      smallint NOT NULL,
  last_pay_year       smallint NOT NULL,
  people              integer NOT NULL,
  exec_years          integer NOT NULL,
  pay_total           numeric(18, 0) NOT NULL,
  status              text NOT NULL,
  start_anchor_date   date,
  start_anchor_reason text,
  end_anchor_date     date,
  calendar_days       integer,
  total_return        double precision,
  bench_total_return  double precision,
  annualized_excess   double precision,
  start_market_cap    numeric(20, 0),
  start_shares_as_of  date,
  methodology_version text NOT NULL,
  PRIMARY KEY (company_id, benchmark_id)
);
