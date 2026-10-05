-- Rankings. The per-seat metric is annualized excess return vs the default benchmark:
--   ((1 + r) / (1 + r_bench))^(365.25 / days) - 1   ("beat the S&P 500 by X% a year")
-- computed by the pipeline (methodology 2026.10.2). Eligibility rules live here so the
-- web app and the API rank identically; see docs/methodology.md "Rankings".
ALTER TABLE tenure_performance ADD COLUMN annualized_excess double precision;

-- One row per seat against the default benchmark, with ranking eligibility.
CREATE VIEW seat_ranking AS
SELECT tp.membership_id, tp.company_id, tp.person_id, m.status AS seat_status,
       tp.status, tp.start_anchor_date, tp.start_anchor_reason, tp.end_anchor_date, tp.calendar_days,
       tp.total_return, tp.bench_total_return, tp.relative_return_pp, tp.annualized_return,
       tp.annualized_excess, tp.max_drawdown, tp.data_through,
       EXISTS (SELECT 1 FROM board_role r WHERE r.membership_id = m.id AND r.role = 'executive_director')
         AS executive_seat,
       (tp.status = 'ok' AND tp.calendar_days >= 365 AND tp.annualized_excess IS NOT NULL) AS rank_eligible
FROM tenure_performance tp
JOIN board_membership m ON m.id = tp.membership_id
WHERE tp.benchmark_id = (SELECT id FROM benchmark WHERE is_default) AND m.seat_type = 'director';

-- One row per person. score = time-weighted geometric mean of annualized excess across the
-- person's eligible seats; a person is ranked only with >= 2 scored years in total.
CREATE VIEW director_scorecard AS
WITH s AS (SELECT * FROM seat_ranking)
SELECT p.id AS person_id, p.slug, p.full_name,
       count(s.membership_id)::int AS seats,
       count(*) FILTER (WHERE s.seat_status = 'current')::int AS current_seats,
       count(*) FILTER (WHERE s.rank_eligible)::int AS scored_seats,
       coalesce(sum(s.calendar_days) FILTER (WHERE s.rank_eligible), 0) / 365.25 AS scored_years,
       exp(sum(s.calendar_days * ln(1 + s.annualized_excess)) FILTER (WHERE s.rank_eligible)
           / nullif(sum(s.calendar_days) FILTER (WHERE s.rank_eligible), 0)) - 1 AS score,
       count(*) FILTER (WHERE s.rank_eligible AND s.relative_return_pp > 0)::int AS beat_seats,
       max(s.annualized_excess) FILTER (WHERE s.rank_eligible) AS best_seat_excess,
       min(s.annualized_excess) FILTER (WHERE s.rank_eligible) AS worst_seat_excess,
       bool_or(s.executive_seat) AS any_executive_seat,
       bool_or(s.executive_seat AND s.rank_eligible) AS scored_executive_seat,
       (coalesce(sum(s.calendar_days) FILTER (WHERE s.rank_eligible), 0) >= 730) AS rank_eligible,
       -- Same score over independent (non-executive) seats only, for the "independent directors" view.
       exp(sum(s.calendar_days * ln(1 + s.annualized_excess)) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat)
           / nullif(sum(s.calendar_days) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat), 0)) - 1
         AS independent_score,
       (coalesce(sum(s.calendar_days) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat), 0) >= 730)
         AS independent_rank_eligible,
       max(s.data_through) AS data_through
FROM person p
JOIN s ON s.person_id = p.id
WHERE p.merged_into_person_id IS NULL
GROUP BY p.id;
