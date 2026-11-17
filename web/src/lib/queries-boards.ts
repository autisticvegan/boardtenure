import "server-only";
import { cache } from "react";
import { sql } from "./db";

/** Board cost per company and fiscal year (non-employee director pay), beside the stock. */
export type BoardYear = {
  company_id: number;
  slug: string;
  common_name: string;
  symbol: string | null;
  fiscal_year: number;
  directors_paid: number;
  board_total: number;
  median_paid: number | null;
  prev_median_paid: number | null;
  start_market_cap: number | null;
  pay_share_of_mcap: number | null;
  total_return: number | null;
  bench_total_return: number | null;
  relative_return_pp: number | null;
  prior_relative_pp: number | null;
};

export const getBoardYears = cache(async (): Promise<BoardYear[]> => sql<BoardYear[]>`
  SELECT b.company_id, c.slug, c.common_name, s.symbol, b.fiscal_year, b.directors_paid, b.board_total, b.median_paid,
         lag(b.median_paid) OVER (PARTITION BY b.company_id ORDER BY b.fiscal_year) AS prev_median_paid,
         b.start_market_cap, b.pay_share_of_mcap, b.total_return, b.bench_total_return, b.relative_return_pp,
         b.prior_relative_pp
  FROM board_pay_year b
  JOIN company c ON c.id = b.company_id
  LEFT JOIN security s ON s.company_id = c.id AND s.is_primary
  ORDER BY c.common_name, b.fiscal_year`);

/**
 * How noisy each stock is against SPY: annualized standard deviation of daily log excess returns
 * since 2016 (tracking error). With the median scored seat length, it sets the smallest
 * per-year effect a single seat's record could distinguish from chance.
 */
export const getDetectability = cache(async () => sql<{
  company_id: number; tracking_error: number; median_seat_years: number | null;
}[]>`
  WITH spy AS (SELECT pd.trade_date, pd.tr_index FROM price_daily pd JOIN benchmark b ON b.security_id = pd.security_id
               WHERE b.code = 'sp500'),
  x AS (SELECT sec.company_id, pd.trade_date, pd.tr_index AS t, spy.tr_index AS b
        FROM price_daily pd JOIN security sec ON sec.id = pd.security_id AND sec.is_primary
        JOIN spy ON spy.trade_date = pd.trade_date
        WHERE pd.trade_date >= '2016-01-01' AND sec.company_id IN (SELECT DISTINCT company_id FROM board_pay_year)),
  d AS (SELECT company_id, ln(t / lag(t) OVER w) - ln(b / lag(b) OVER w) AS ex FROM x
        WINDOW w AS (PARTITION BY company_id ORDER BY trade_date))
  SELECT d.company_id, stddev(d.ex) * sqrt(252) AS tracking_error,
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY calendar_days) / 365.25 FROM seat_ranking sr
          WHERE sr.company_id = d.company_id AND sr.rank_eligible) AS median_seat_years
  FROM d GROUP BY d.company_id`);

export type ReactionStat = {
  category: "appointed" | "elected" | "resigned" | "not_standing" | "exec_change";
  n: number;
  mean_car: number;
  median_car: number;
  sd_car: number;
  pct_positive: number;
  median_market_cap: number | null;
  z: number;  // standardized: each event's move divided by its own stock's three-day noise
  set_aside: number;  // same-day earnings, other material 8-Ks, or several board changes at once
};

/** Market reaction to board changes (director_event), by kind of change. */
export const getReactionStats = cache(async (): Promise<ReactionStat[]> => sql<ReactionStat[]>`
  SELECT category, count(*)::int AS n, avg(car) AS mean_car,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY car) AS median_car, stddev(car) AS sd_car,
         avg((car > 0)::int) AS pct_positive,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY start_market_cap) AS median_market_cap,
         sum(car / (sigma * sqrt(3))) / sqrt(count(*)) AS z,
         (SELECT count(*)::int FROM director_event d2 WHERE d2.category = d.category
            AND (d2.near_earnings OR d2.other_news OR d2.bundled)) AS set_aside
  FROM director_event d
  WHERE NOT (near_earnings OR other_news OR bundled)
  GROUP BY category ORDER BY count(*) DESC`);

export type BigReaction = {
  slug: string; common_name: string; day0: string; car: number; summary: string; near_earnings: boolean; other_news: boolean;
};

/** The largest three-day moves either way, so readers can see what else happened those days. */
export const getBiggestReactions = cache(async (limit = 6): Promise<BigReaction[]> => sql<BigReaction[]>`
  SELECT c.slug, c.common_name, d.day0::text, d.car, d.summaries[1] AS summary, d.near_earnings, d.other_news
  FROM director_event d JOIN company c ON c.id = d.company_id
  ORDER BY abs(d.car) DESC LIMIT ${limit}`);

export type SeatDirectorCompRow = {
  fiscal_year: number;
  fees_cash: number;
  stock_awards: number;
  option_awards: number;
  all_other: number;
  total: number;
  excluded_from_board_cost: boolean;
  filed_on: string;
  source_url: string;
  relative_return_pp: number | null;
};

/** Year-by-year Director Compensation table rows for one board seat, newest first. */
export const getSeatDirectorComp = cache(async (companyId: number, personId: number): Promise<SeatDirectorCompRow[]> => sql<SeatDirectorCompRow[]>`
  SELECT d.fiscal_year, d.fees_cash::float8, d.stock_awards::float8, d.option_awards::float8,
         (d.non_equity_incentive + d.pension_nqdc + d.all_other)::float8 AS all_other,
         d.total::float8, d.excluded_from_board_cost, d.filed_on::text, d.source_url,
         b.relative_return_pp
  FROM director_comp_latest d
  LEFT JOIN board_pay_year b ON b.company_id = d.company_id AND b.fiscal_year = d.fiscal_year
  WHERE d.company_id = ${companyId} AND d.person_id = ${personId}
  ORDER BY d.fiscal_year DESC`);

export type PersonDirectorComp = {
  company_slug: string;
  company_name: string;
  symbol: string | null;
  years: number;
  first_year: number;
  last_year: number;
  total_paid: number;
  cash_total: number;
  equity_total: number;
  annualized_excess: number | null;
  relative_return_pp: number | null;
};

/** Cumulative non-employee board compensation per company for one director. */
export const getPersonDirectorComp = cache(async (personId: number): Promise<PersonDirectorComp[]> => sql<PersonDirectorComp[]>`
  SELECT c.slug AS company_slug, c.common_name AS company_name, s.symbol,
         count(*)::int AS years, min(d.fiscal_year)::int AS first_year, max(d.fiscal_year)::int AS last_year,
         sum(d.total)::float8 AS total_paid, sum(d.fees_cash)::float8 AS cash_total,
         sum(d.stock_awards + d.option_awards)::float8 AS equity_total,
         (SELECT sr.annualized_excess FROM seat_ranking sr WHERE sr.company_id = c.id AND sr.person_id = ${personId}
          ORDER BY sr.rank_eligible DESC, sr.calendar_days DESC NULLS LAST LIMIT 1) AS annualized_excess,
         (SELECT sr.relative_return_pp FROM seat_ranking sr WHERE sr.company_id = c.id AND sr.person_id = ${personId}
          ORDER BY sr.rank_eligible DESC, sr.calendar_days DESC NULLS LAST LIMIT 1) AS relative_return_pp
  FROM director_comp_latest d
  JOIN company c ON c.id = d.company_id
  LEFT JOIN security s ON s.company_id = c.id AND s.is_primary
  WHERE d.person_id = ${personId} AND NOT d.excluded_from_board_cost AND d.total > 0
  GROUP BY c.id, c.slug, c.common_name, s.symbol
  ORDER BY sum(d.total) DESC`);

export type DirectorSeatPayLeader = {
  person_slug: string;
  full_name: string;
  company_slug: string;
  company_name: string;
  symbol: string | null;
  years: number;
  first_year: number;
  last_year: number;
  total_paid: number;
  annualized_excess: number;
  calendar_days: number;
};

/** Non-employee directors ranked by cumulative reported board pay alongside the seat's scored return vs S&P 500. */
export const getDirectorPayLeaders = cache(async (): Promise<DirectorSeatPayLeader[]> => sql<DirectorSeatPayLeader[]>`
  SELECT p.slug AS person_slug, p.full_name, c.slug AS company_slug, c.common_name AS company_name, s.symbol,
         count(*)::int AS years, min(d.fiscal_year)::int AS first_year, max(d.fiscal_year)::int AS last_year,
         sum(d.total)::float8 AS total_paid, sr.annualized_excess, sr.calendar_days
  FROM director_comp_latest d
  JOIN person p ON p.id = d.person_id
  JOIN company c ON c.id = d.company_id
  LEFT JOIN security s ON s.company_id = c.id AND s.is_primary
  JOIN LATERAL (
    SELECT annualized_excess, calendar_days FROM seat_ranking sr2
    WHERE sr2.company_id = d.company_id AND sr2.person_id = d.person_id AND sr2.rank_eligible AND NOT sr2.executive_seat
    ORDER BY sr2.calendar_days DESC LIMIT 1
  ) sr ON true
  WHERE NOT d.excluded_from_board_cost AND d.total > 0
  GROUP BY p.id, p.slug, p.full_name, c.id, c.slug, c.common_name, s.symbol, sr.annualized_excess, sr.calendar_days
  ORDER BY sum(d.total) DESC`);
