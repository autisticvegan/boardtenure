-- Director pay, executive exit packages, and a market-wide pay-versus-performance screen.

-- One row per (filing, director, fiscal year) from the proxy's Director Compensation table.
CREATE TABLE director_comp (
  id                    bigserial PRIMARY KEY,
  company_id            bigint NOT NULL REFERENCES company,
  person_id             bigint NOT NULL REFERENCES person,
  fiscal_year           smallint NOT NULL,
  fiscal_year_end       date NOT NULL,
  source_document_id    bigint NOT NULL REFERENCES source_document,
  evidence_id           bigint REFERENCES evidence,
  listed_name           text,
  fees_cash             numeric(16, 0) NOT NULL DEFAULT 0,
  stock_awards          numeric(16, 0) NOT NULL DEFAULT 0,  -- grant-date fair value
  option_awards         numeric(16, 0) NOT NULL DEFAULT 0,
  non_equity_incentive  numeric(16, 0) NOT NULL DEFAULT 0,
  pension_nqdc          numeric(16, 0) NOT NULL DEFAULT 0,
  all_other             numeric(16, 0) NOT NULL DEFAULT 0,
  total                 numeric(16, 0) NOT NULL,
  notes                 text,
  UNIQUE (source_document_id, person_id, fiscal_year)
);
CREATE TRIGGER director_comp_audit AFTER INSERT OR UPDATE OR DELETE ON director_comp
  FOR EACH ROW EXECUTE FUNCTION bt_audit();

CREATE VIEW director_comp_latest AS
SELECT DISTINCT ON (dc.company_id, dc.person_id, dc.fiscal_year)
       dc.*, sd.published_at AS filed_on, sd.url AS source_url
FROM director_comp dc
JOIN source_document sd ON sd.id = dc.source_document_id
ORDER BY dc.company_id, dc.person_id, dc.fiscal_year,
         abs(dc.fees_cash + dc.stock_awards + dc.option_awards + dc.non_equity_incentive + dc.pension_nqdc
             + dc.all_other - dc.total) <= 1 DESC,
         sd.published_at DESC, dc.id DESC;

-- What an executive received on the way out. NULL components weren't quantified in any filing.
CREATE TABLE executive_exit (
  id                        bigserial PRIMARY KEY,
  company_id                bigint NOT NULL REFERENCES company,
  person_id                 bigint NOT NULL REFERENCES person,
  role                      text,
  exit_date                 date,
  exit_date_precision       text NOT NULL DEFAULT 'day' CHECK (exit_date_precision IN ('day', 'month', 'year', 'unknown')),
  exit_type                 text NOT NULL CHECK (exit_type IN ('resigned', 'retired', 'terminated_without_cause',
                              'terminated_for_cause', 'mutual', 'death', 'change_in_control', 'other')),
  basis                     text NOT NULL CHECK (basis IN ('actual', 'estimated')),
  severance_cash            numeric(16, 0),
  accelerated_equity_value  numeric(16, 0),
  consulting_fees           numeric(16, 0),
  other_exit_pay            numeric(16, 0),
  total_exit_pay            numeric(16, 0),
  evidence_ids              bigint[] NOT NULL,
  notes                     text
);
CREATE TRIGGER executive_exit_audit AFTER INSERT OR UPDATE OR DELETE ON executive_exit
  FOR EACH ROW EXECUTE FUNCTION bt_audit();

-- Facts from SEC XBRL frames (one value per company per calendar-aligned period, from the latest
-- filing that reports it), e.g. ecd:PeoTotalCompAmt for every proxy filer. Screening data: cases
-- featured on the site are re-verified against the filing itself.
CREATE TABLE xbrl_frame_fact (
  taxonomy     text NOT NULL,
  concept      text NOT NULL,
  unit         text NOT NULL,
  frame        text NOT NULL,          -- 'CY2024'
  cik          bigint NOT NULL,
  entity_name  text NOT NULL,
  accession    text NOT NULL,
  period_start date,
  period_end   date NOT NULL,
  value        numeric(24, 4) NOT NULL,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (taxonomy, concept, unit, frame, cik)
);
CREATE INDEX xbrl_frame_fact_cik ON xbrl_frame_fact (cik, concept);

-- Exchange tickers for screened issuers (SEC company_tickers.json).
CREATE TABLE sec_ticker (
  cik      bigint NOT NULL,
  ticker   text NOT NULL,
  title    text NOT NULL,
  PRIMARY KEY (cik, ticker)
);

-- Per company, over the latest proxy's own pay-versus-performance table: CEO reported pay and
-- "actually paid" summed over the years that table covers, and its cumulative TSR (value of $100
-- invested at the table's start). The span is the set of frames whose TSR comes from that filing.
CREATE VIEW pvp_screen AS
WITH f AS (
  SELECT cik, concept, frame, value, entity_name, accession, period_start, period_end
  FROM xbrl_frame_fact WHERE taxonomy = 'ecd'
),
latest AS (
  SELECT DISTINCT ON (cik) cik, frame, value AS tsr_value_of_100, accession, period_end
  FROM f WHERE concept = 'TotalShareholderRtnAmt' ORDER BY cik, frame DESC
),
span AS (
  SELECT l.cik, f.frame FROM latest l
  JOIN f ON f.cik = l.cik AND f.concept = 'TotalShareholderRtnAmt' AND f.accession = l.accession
)
SELECT l.cik, max(f.entity_name) AS entity_name,
       (SELECT string_agg(st.ticker, ', ' ORDER BY st.ticker) FROM sec_ticker st WHERE st.cik = l.cik) AS tickers,
       l.frame AS latest_frame, l.period_end AS latest_period_end, l.tsr_value_of_100, l.accession,
       min(f.frame) AS first_frame,
       min(f.period_start) FILTER (WHERE f.concept = 'PeoTotalCompAmt') AS span_start,
       count(*) FILTER (WHERE f.concept = 'PeoTotalCompAmt') AS peo_years,
       count(DISTINCT f.frame) AS span_years,
       sum(f.value) FILTER (WHERE f.concept = 'PeoTotalCompAmt') AS peo_sct_sum,
       sum(f.value) FILTER (WHERE f.concept = 'PeoActuallyPaidCompAmt') AS peo_cap_sum,
       max(f.value) FILTER (WHERE f.concept = 'PeoTotalCompAmt' AND f.frame = l.frame) AS peo_sct_latest,
       sum(f.value) FILTER (WHERE f.concept = 'NonPeoNeoAvgTotalCompAmt') AS other_neo_avg_sct_sum,
       max(f.value) FILTER (WHERE f.concept = 'PeerGroupTotalShareholderRtnAmt' AND f.frame = l.frame)
         AS peer_tsr_value_of_100
FROM latest l
JOIN span s ON s.cik = l.cik
JOIN f ON f.cik = l.cik AND f.frame = s.frame
GROUP BY l.cik, l.frame, l.period_end, l.tsr_value_of_100, l.accession;
