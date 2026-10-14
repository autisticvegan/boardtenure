-- CEO pay tagged per person (ecd:IndividualAxis), read from the proxy itself. Years with two CEOs,
-- and companies that always tag the CEO by name, have no undimensioned value in XBRL frames.
CREATE TABLE pvp_peo_fact (
  cik         bigint NOT NULL,
  accession   text NOT NULL,
  period_end  date NOT NULL,
  member      text NOT NULL,          -- e.g. lyft:DavidRisherMember
  peo_name    text,
  concept     text NOT NULL CHECK (concept IN ('PeoTotalCompAmt', 'PeoActuallyPaidCompAmt')),
  value       numeric(24, 4) NOT NULL,
  PRIMARY KEY (cik, accession, period_end, member, concept)
);

-- As before, but a year's CEO pay falls back to the sum of its per-person facts (both CEOs in a
-- year with a change) when the undimensioned frame value is missing or a nil zero.
DROP VIEW pvp_screen;
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
  SELECT l.cik, f.frame, f.period_start, f.period_end FROM latest l
  JOIN f ON f.cik = l.cik AND f.concept = 'TotalShareholderRtnAmt' AND f.accession = l.accession
),
yr AS (
  SELECT s.cik, s.frame, s.period_start, s.period_end,
         coalesce(nullif(max(f.value) FILTER (WHERE f.concept = 'PeoTotalCompAmt'), 0),
                  (SELECT sum(d.value) FROM pvp_peo_fact d JOIN latest l2 ON l2.cik = d.cik AND l2.accession = d.accession
                   WHERE d.cik = s.cik AND d.period_end = s.period_end AND d.concept = 'PeoTotalCompAmt')) AS peo_sct,
         coalesce(nullif(max(f.value) FILTER (WHERE f.concept = 'PeoActuallyPaidCompAmt'), 0),
                  (SELECT sum(d.value) FROM pvp_peo_fact d JOIN latest l2 ON l2.cik = d.cik AND l2.accession = d.accession
                   WHERE d.cik = s.cik AND d.period_end = s.period_end AND d.concept = 'PeoActuallyPaidCompAmt'))
           AS peo_cap,
         max(f.value) FILTER (WHERE f.concept = 'NonPeoNeoAvgTotalCompAmt') AS other_avg,
         max(f.value) FILTER (WHERE f.concept = 'PeerGroupTotalShareholderRtnAmt') AS peer_tsr,
         max(f.entity_name) AS entity_name
  FROM span s LEFT JOIN f ON f.cik = s.cik AND f.frame = s.frame
  GROUP BY s.cik, s.frame, s.period_start, s.period_end
)
SELECT l.cik, max(y.entity_name) AS entity_name,
       (SELECT string_agg(st.ticker, ', ' ORDER BY st.ticker) FROM sec_ticker st WHERE st.cik = l.cik) AS tickers,
       l.frame AS latest_frame, l.period_end AS latest_period_end, l.tsr_value_of_100, l.accession,
       min(y.frame) AS first_frame, min(y.period_start) AS span_start,
       count(y.peo_sct)::int AS peo_years, count(*)::int AS span_years,
       sum(y.peo_sct) AS peo_sct_sum, sum(y.peo_cap) AS peo_cap_sum,
       max(y.peo_sct) FILTER (WHERE y.frame = l.frame) AS peo_sct_latest,
       sum(y.other_avg) AS other_neo_avg_sct_sum,
       max(y.peer_tsr) FILTER (WHERE y.frame = l.frame) AS peer_tsr_value_of_100
FROM latest l JOIN yr y ON y.cik = l.cik
GROUP BY l.cik, l.frame, l.period_end, l.tsr_value_of_100, l.accession;
