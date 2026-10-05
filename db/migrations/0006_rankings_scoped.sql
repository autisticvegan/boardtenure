-- Scope-aware ranking stats. CREATE OR REPLACE VIEW may only append columns, so existing
-- columns stay in order and new ones go at the end. director_scorecard depends on
-- seat_ranking, so it is dropped and recreated around the seat_ranking change.
DROP VIEW director_scorecard;

CREATE OR REPLACE VIEW seat_ranking AS
SELECT tp.membership_id, tp.company_id, tp.person_id, m.status AS seat_status,
       tp.status, tp.start_anchor_date, tp.start_anchor_reason, tp.end_anchor_date, tp.calendar_days,
       tp.total_return, tp.bench_total_return, tp.relative_return_pp, tp.annualized_return,
       tp.annualized_excess, tp.max_drawdown, tp.data_through,
       EXISTS (SELECT 1 FROM board_role r WHERE r.membership_id = m.id AND r.role = 'executive_director')
         AS executive_seat,
       (tp.status = 'ok' AND tp.calendar_days >= 365 AND tp.annualized_excess IS NOT NULL) AS rank_eligible,
       tp.mdd_peak_date, tp.mdd_trough_date,
       (SELECT r.officer_title FROM board_role r
         WHERE r.membership_id = m.id AND r.role = 'executive_director'
         ORDER BY r.start_date DESC NULLS LAST LIMIT 1) AS executive_title,
       m.start_date, m.start_precision, m.end_date, m.end_precision,
       tp.return_low, tp.return_high
FROM tenure_performance tp
JOIN board_membership m ON m.id = tp.membership_id
WHERE tp.benchmark_id = (SELECT id FROM benchmark WHERE is_default) AND m.seat_type = 'director';

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
       exp(sum(s.calendar_days * ln(1 + s.annualized_excess)) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat)
           / nullif(sum(s.calendar_days) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat), 0)) - 1
         AS independent_score,
       (coalesce(sum(s.calendar_days) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat), 0) >= 730)
         AS independent_rank_eligible,
       max(s.data_through) AS data_through,
       -- appended in 0006: board counts and non-exec ("independent") versions of every per-scope stat
       count(DISTINCT s.company_id) FILTER (WHERE s.rank_eligible)::int AS scored_boards,
       count(*) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat)::int AS independent_scored_seats,
       coalesce(sum(s.calendar_days) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat), 0) / 365.25
         AS independent_scored_years,
       count(*) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat AND s.relative_return_pp > 0)::int
         AS independent_beat_seats,
       max(s.annualized_excess) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat) AS independent_best_seat_excess,
       min(s.annualized_excess) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat) AS independent_worst_seat_excess,
       count(DISTINCT s.company_id) FILTER (WHERE s.rank_eligible AND NOT s.executive_seat)::int
         AS independent_scored_boards
FROM person p
JOIN s ON s.person_id = p.id
WHERE p.merged_into_person_id IS NULL
GROUP BY p.id;
