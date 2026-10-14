-- Replace the float-based screen: a stock that collapsed shrinks the float and would flag real
-- mega-grants. A scale error instead inflates (or shrinks) every figure in the filing, so flag a
-- company when every year's other-executive average is above $100M, or every CEO figure is under
-- $1,000. pvp_override can confirm or exclude a company by hand.
DROP VIEW pvp_screen_ok;
CREATE VIEW pvp_screen_ok AS
SELECT c.*,
       CASE WHEN c.override = 'confirmed' THEN false
            WHEN c.override = 'excluded' THEN true
            ELSE coalesce(o.min_other_avg > 100000000, false) OR coalesce(c.max_year_pay < 1000, false)
       END AS implausible
FROM pvp_screen_checked c
LEFT JOIN LATERAL (SELECT min(value) AS min_other_avg FROM xbrl_frame_fact f
                   WHERE f.cik = c.cik AND f.accession = c.accession AND f.concept = 'NonPeoNeoAvgTotalCompAmt') o ON true;
