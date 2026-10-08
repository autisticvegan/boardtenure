-- Executive pay (named executive officers) and the stock during each executive's tenure.
-- Pay comes from the proxy Summary Compensation Table (SCT) and the Pay versus Performance
-- table; tenures are officer stints, parallel to board_membership. See docs/methodology.md "Executive pay".

CREATE TABLE executive_position (
  id               bigserial PRIMARY KEY,
  company_id       bigint NOT NULL REFERENCES company,
  person_id        bigint NOT NULL REFERENCES person,
  title            text NOT NULL,
  start_date       date,
  start_precision  text NOT NULL CHECK (start_precision IN ('day', 'month', 'year', 'unknown')),
  start_basis      text,
  end_date         date,
  end_precision    text CHECK (end_precision IN ('day', 'month', 'year', 'unknown')),
  end_reason       text,
  is_current       boolean NOT NULL,
  confidence       text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  review_status    text NOT NULL DEFAULT 'unreviewed'
                     CHECK (review_status IN ('unreviewed', 'auto_accepted', 'reviewed', 'disputed')),
  is_locked        boolean NOT NULL DEFAULT false,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((start_precision = 'unknown') = (start_date IS NULL)),
  CHECK (NOT is_current OR end_date IS NULL)
);
CREATE UNIQUE INDEX executive_position_natural
  ON executive_position (company_id, person_id, title, coalesce(start_date, '0001-01-01'));

-- One row per (filing, person, fiscal year). A year is repeated in up to three proxies; every
-- appearance is kept so restatements stay visible, and executive_comp_latest picks the newest.
CREATE TABLE executive_comp (
  id                    bigserial PRIMARY KEY,
  company_id            bigint NOT NULL REFERENCES company,
  person_id             bigint NOT NULL REFERENCES person,
  fiscal_year           smallint NOT NULL,
  fiscal_year_end       date NOT NULL,
  source_document_id    bigint NOT NULL REFERENCES source_document,
  evidence_id           bigint REFERENCES evidence,
  listed_title          text,
  salary                numeric(16, 0) NOT NULL DEFAULT 0,
  bonus                 numeric(16, 0) NOT NULL DEFAULT 0,
  stock_awards          numeric(16, 0) NOT NULL DEFAULT 0,  -- grant-date fair value, not realized
  option_awards         numeric(16, 0) NOT NULL DEFAULT 0,
  non_equity_incentive  numeric(16, 0) NOT NULL DEFAULT 0,
  pension_nqdc          numeric(16, 0) NOT NULL DEFAULT 0,
  all_other             numeric(16, 0) NOT NULL DEFAULT 0,
  total                 numeric(16, 0) NOT NULL,
  notes                 text,
  UNIQUE (source_document_id, person_id, fiscal_year)
);

-- Item 402(v) table rows, one per (filing, fiscal year); PEOs in their own table because a
-- year with a CEO change reports two.
CREATE TABLE pay_vs_performance (
  source_document_id              bigint NOT NULL REFERENCES source_document,
  fiscal_year                     smallint NOT NULL,
  company_id                      bigint NOT NULL REFERENCES company,
  evidence_id                     bigint REFERENCES evidence,
  non_peo_avg_sct_total           numeric(16, 0),
  non_peo_avg_cap                 numeric(16, 0),
  tsr_value_of_100                double precision,
  peer_tsr_value_of_100           double precision,
  peer_group                      text,
  tsr_base_date                   date,
  net_income_usd                  numeric(18, 0),
  company_selected_measure        text,
  company_selected_measure_value  text,
  notes                           text,
  PRIMARY KEY (source_document_id, fiscal_year)
);
CREATE TABLE pay_vs_performance_peo (
  source_document_id  bigint NOT NULL,
  fiscal_year         smallint NOT NULL,
  person_id           bigint NOT NULL REFERENCES person,
  sct_total           numeric(16, 0),
  cap                 numeric(16, 0),                      -- "compensation actually paid"
  PRIMARY KEY (source_document_id, fiscal_year, person_id),
  FOREIGN KEY (source_document_id, fiscal_year) REFERENCES pay_vs_performance ON DELETE CASCADE
);

-- Stock vs benchmark for each executive's officer tenure (all titles merged into one span).
-- window_kind 'tenure' runs to the end of the tenure (or the latest close); 'pay' covers only the
-- fiscal years with reported pay, clipped to the tenure, so pay and stock cover the same period.
-- The pay_* columns (set on 'pay' rows) sum the fiscal years counted in that window.
CREATE TABLE executive_tenure_performance (
  company_id               bigint NOT NULL REFERENCES company,
  person_id                bigint NOT NULL REFERENCES person,
  benchmark_id             smallint NOT NULL REFERENCES benchmark,
  window_kind              text NOT NULL CHECK (window_kind IN ('tenure', 'pay')),
  security_id              bigint REFERENCES security,
  tenure_start             date,
  tenure_start_precision   text NOT NULL,
  tenure_end               date,
  tenure_end_precision     text,
  is_current               boolean NOT NULL,
  titles                   text[] NOT NULL,
  status                   text NOT NULL,
  start_anchor_date        date,
  start_anchor_reason      text,
  end_anchor_date          date,
  end_anchor_reason        text,
  start_close              numeric(18, 6),
  end_close                numeric(18, 6),
  calendar_days            integer,
  total_return             double precision,
  annualized_return        double precision,
  bench_total_return       double precision,
  relative_return_pp       double precision,
  excess_return            double precision,
  annualized_excess        double precision,
  max_drawdown             double precision,
  return_low               double precision,
  return_high              double precision,
  start_shares             numeric(20, 0),
  start_shares_as_of       date,
  start_market_cap         numeric(20, 0),
  pay_years                integer,
  pay_total                numeric(18, 0),
  equity_awards            numeric(18, 0),
  first_pay_year           smallint,
  last_pay_year            smallint,
  data_through             date,
  methodology_version      text NOT NULL,
  computed_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, person_id, benchmark_id, window_kind)
);

-- The stock in each fiscal year an executive was paid for, restricted to the part of the year
-- inside their tenure and after listing.
CREATE TABLE executive_year_performance (
  company_id          bigint NOT NULL REFERENCES company,
  person_id           bigint NOT NULL REFERENCES person,
  benchmark_id        smallint NOT NULL REFERENCES benchmark,
  fiscal_year         smallint NOT NULL,
  status              text NOT NULL,
  start_anchor_date   date,
  end_anchor_date     date,
  calendar_days       integer,
  total_return        double precision,
  bench_total_return  double precision,
  relative_return_pp  double precision,
  methodology_version text NOT NULL,
  PRIMARY KEY (company_id, person_id, benchmark_id, fiscal_year)
);

ALTER TABLE evidence_link DROP CONSTRAINT evidence_link_subject_type_check;
ALTER TABLE evidence_link ADD CONSTRAINT evidence_link_subject_type_check
  CHECK (subject_type IN ('company', 'person', 'board_membership', 'board_role', 'board_event', 'board_snapshot',
                          'corporate_action', 'person_affiliation', 'board_independence', 'extracted_fact',
                          'executive_position', 'executive_comp', 'pay_vs_performance'));

CREATE TRIGGER executive_position_audit AFTER INSERT OR UPDATE OR DELETE ON executive_position
  FOR EACH ROW EXECUTE FUNCTION bt_audit();
CREATE TRIGGER executive_position_touch BEFORE UPDATE ON executive_position
  FOR EACH ROW EXECUTE FUNCTION bt_touch_updated_at();
CREATE TRIGGER executive_comp_audit AFTER INSERT OR UPDATE OR DELETE ON executive_comp
  FOR EACH ROW EXECUTE FUNCTION bt_audit();

-- The newest filing's figures for each (person, fiscal year).
CREATE VIEW executive_comp_latest AS
SELECT DISTINCT ON (ec.company_id, ec.person_id, ec.fiscal_year)
       ec.*, sd.published_at AS filed_on, sd.url AS source_url, sd.doc_type AS source_form
FROM executive_comp ec
JOIN source_document sd ON sd.id = ec.source_document_id
ORDER BY ec.company_id, ec.person_id, ec.fiscal_year, sd.published_at DESC, ec.id DESC;

CREATE VIEW pay_vs_performance_latest AS
SELECT DISTINCT ON (p.company_id, p.fiscal_year) p.*, sd.published_at AS filed_on, sd.url AS source_url
FROM pay_vs_performance p
JOIN source_document sd ON sd.id = p.source_document_id
ORDER BY p.company_id, p.fiscal_year, sd.published_at DESC;

-- Pay set against the stock over the same window (window_kind = 'pay'), against SPY.
-- excess_wealth: what a holder of the whole company at the start ended with, minus the same
-- money in the benchmark: start_market_cap * (total_return - bench_total_return).
CREATE VIEW executive_pay_performance AS
SELECT etp.*,
       etp.pay_total / nullif(etp.pay_years, 0) AS pay_per_year,
       etp.start_market_cap * (etp.total_return - etp.bench_total_return) AS excess_wealth,
       etp.start_market_cap * (etp.total_return - etp.bench_total_return) / nullif(etp.pay_total, 0)
         AS excess_wealth_per_pay_dollar
FROM executive_tenure_performance etp
JOIN benchmark b ON b.id = etp.benchmark_id AND b.code = 'sp500'
WHERE etp.window_kind = 'pay';
