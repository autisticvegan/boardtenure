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
};

/** Market reaction to board changes (director_event), by kind of change. */
export const getReactionStats = cache(async (): Promise<ReactionStat[]> => sql<ReactionStat[]>`
  SELECT category, count(*)::int AS n, avg(car) AS mean_car,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY car) AS median_car, stddev(car) AS sd_car,
         avg((car > 0)::int) AS pct_positive,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY start_market_cap) AS median_market_cap,
         sum(car / (sigma * sqrt(3))) / sqrt(count(*)) AS z
  FROM director_event GROUP BY category ORDER BY count(*) DESC`);

export type BigReaction = { slug: string; common_name: string; day0: string; car: number; summary: string };

/** The largest three-day moves either way, so readers can see what else happened those days. */
export const getBiggestReactions = cache(async (limit = 6): Promise<BigReaction[]> => sql<BigReaction[]>`
  SELECT c.slug, c.common_name, d.day0::text, d.car, d.summaries[1] AS summary
  FROM director_event d JOIN company c ON c.id = d.company_id
  ORDER BY abs(d.car) DESC LIMIT ${limit}`);
