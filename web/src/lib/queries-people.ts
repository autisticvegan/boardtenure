import "server-only";
import { cache } from "react";
import { sql } from "./db";
import type { RankScope, SeatRef } from "./queries";

/**
 * Every director seat a person holds or held, as SeatRefs for the scope (ranked or not).
 * Scope-scored seats first, best first; then the rest by start. Ranks are not computed here.
 */
export const getPersonSeats = cache(async (personId: number, scope: RankScope): Promise<SeatRef[]> => {
  const inScope = scope === "independent" ? sql`sr.rank_eligible AND NOT sr.executive_seat` : sql`sr.rank_eligible`;
  return sql<SeatRef[]>`
    SELECT sr.membership_id, c.slug AS company_slug, c.common_name AS company_name, sec.symbol,
           sr.seat_status, sr.status AS perf_status, sr.executive_seat, sr.executive_title, sr.rank_eligible,
           (${inScope}) AS in_scope, sr.annualized_excess, sr.total_return, sr.bench_total_return,
           sr.relative_return_pp, sr.calendar_days, sr.max_drawdown, sr.mdd_peak_date::text, sr.mdd_trough_date::text,
           sr.start_anchor_reason, sr.start_anchor_date::text, sr.end_anchor_date::text, sr.start_date::text,
           sr.start_precision, sr.end_date::text, sr.end_precision, sr.return_low, sr.return_high
    FROM seat_ranking sr
    JOIN company c ON c.id = sr.company_id
    LEFT JOIN security sec ON sec.company_id = c.id AND sec.is_primary
    WHERE sr.person_id = ${personId}
    ORDER BY (${inScope}) DESC, sr.rank_eligible DESC, sr.annualized_excess DESC NULLS LAST,
             sr.start_anchor_date NULLS LAST, sr.start_date NULLS LAST`;
});
