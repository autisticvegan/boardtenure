-- Two more screen rules. (1) "$100 became" can't be negative: a negative TSR figure means the company
-- tagged a percentage change, so its table can't be read as value of $100. (2) Featured lists favour
-- companies readers know: notable = largest public float on file at least $500M (floats above $50T
-- are tagging errors and don't count).
DROP VIEW pvp_screen_ok;
CREATE VIEW pvp_screen_ok AS
SELECT c.*,
       CASE WHEN c.override = 'confirmed' THEN false
            WHEN c.override = 'excluded' THEN true
            ELSE coalesce(o.min_other_avg > 100000000, false)
                 OR (coalesce(c.max_year_pay < 1000, false) AND coalesce(o.max_other_avg < 1000, false))
                 OR coalesce(t.min_tsr < 0, false)
       END AS implausible,
       coalesce(fl.max_float BETWEEN 500000000 AND 50000000000000, false) AS notable,
       fl.max_float
FROM pvp_screen_checked c
LEFT JOIN LATERAL (SELECT min(value) AS min_other_avg, max(value) AS max_other_avg FROM xbrl_frame_fact f
                   WHERE f.cik = c.cik AND f.accession = c.accession AND f.concept = 'NonPeoNeoAvgTotalCompAmt') o ON true
LEFT JOIN LATERAL (SELECT min(value) AS min_tsr FROM xbrl_frame_fact f
                   WHERE f.cik = c.cik AND f.accession = c.accession AND f.concept = 'TotalShareholderRtnAmt') t ON true
LEFT JOIN LATERAL (SELECT max(value) FILTER (WHERE value <= 50000000000000) AS max_float FROM xbrl_frame_fact f
                   WHERE f.cik = c.cik AND f.concept = 'EntityPublicFloat') fl ON true;
