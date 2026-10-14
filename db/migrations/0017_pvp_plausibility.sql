-- Plausibility screen: a company's tagged XBRL can carry the wrong scale (dollars tagged as
-- thousands, so pay reads 1,000x). Any year whose tagged CEO pay exceeds both 10% of the company's
-- public float and $50M is flagged; flagged companies stay out of lists and statistics until checked.
CREATE TABLE pvp_override (
  cik      bigint PRIMARY KEY,
  status   text NOT NULL CHECK (status IN ('confirmed', 'excluded')),
  note     text NOT NULL,
  set_at   timestamptz NOT NULL DEFAULT now()
);

CREATE VIEW pvp_screen_checked AS
SELECT s.*,
       fl.value AS public_float,
       (SELECT max(v) FROM (
          SELECT coalesce(nullif(max(f.value) FILTER (WHERE f.concept = 'PeoTotalCompAmt'), 0),
                          (SELECT sum(d.value) FROM pvp_peo_fact d WHERE d.cik = s.cik AND d.accession = s.accession
                             AND d.period_end = f.period_end AND d.concept = 'PeoTotalCompAmt')) AS v
          FROM xbrl_frame_fact f WHERE f.cik = s.cik AND f.accession = s.accession AND f.taxonomy = 'ecd'
          GROUP BY f.period_end) y) AS max_year_pay,
       o.status AS override
FROM pvp_screen s
LEFT JOIN LATERAL (SELECT value FROM xbrl_frame_fact WHERE cik = s.cik AND concept = 'EntityPublicFloat'
                   ORDER BY frame DESC LIMIT 1) fl ON true
LEFT JOIN pvp_override o ON o.cik = s.cik;

CREATE VIEW pvp_screen_ok AS
-- Without a float on file, only a year above $1B is flagged.
SELECT *, coalesce(max_year_pay > CASE WHEN public_float IS NULL THEN 1000000000
                                       ELSE greatest(50000000, 0.10 * public_float) END, false) AS implausible
FROM pvp_screen_checked;
