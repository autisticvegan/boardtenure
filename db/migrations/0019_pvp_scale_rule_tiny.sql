-- A CEO can really be paid next to nothing (a symbolic salary), so a tiny-scale error needs every
-- figure tiny: CEO and other executives alike.
DROP VIEW pvp_screen_ok;
CREATE VIEW pvp_screen_ok AS
SELECT c.*,
       CASE WHEN c.override = 'confirmed' THEN false
            WHEN c.override = 'excluded' THEN true
            ELSE coalesce(o.min_other_avg > 100000000, false)
                 OR (coalesce(c.max_year_pay < 1000, false) AND coalesce(o.max_other_avg < 1000, false))
       END AS implausible
FROM pvp_screen_checked c
LEFT JOIN LATERAL (SELECT min(value) AS min_other_avg, max(value) AS max_other_avg FROM xbrl_frame_fact f
                   WHERE f.cik = c.cik AND f.accession = c.accession AND f.concept = 'NonPeoNeoAvgTotalCompAmt') o ON true;
