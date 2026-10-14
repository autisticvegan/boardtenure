import "server-only";
import { cache } from "react";
import { sql } from "./db";

/**
 * Heads I Win: the market-wide pay-versus-performance screen (SEC XBRL frames) and exit packages.
 * Only cases checked against their proxy (pvp_case.verified) are shown by name; the rest feed
 * aggregate statistics only.
 */

export type ScreenCase = {
  cik: number;
  entity_name: string;
  tickers: string | null;
  ceos: string[];
  first_frame: string;
  latest_frame: string;
  span_years: number;
  peo_years: number;
  tsr_value_of_100: number;
  peer_tsr_value_of_100: number | null;
  peo_sct_sum: number | null;
  peo_cap_sum: number | null;
  peo_sct_latest: number | null;
  accession: string;
  doc_url: string | null;
};

const CASE_COLUMNS = sql`
  s.cik, s.entity_name, s.tickers, coalesce(c.peo_names, '{}') AS ceos, s.first_frame, s.latest_frame,
  s.span_years, s.peo_years, s.tsr_value_of_100, s.peer_tsr_value_of_100, s.peo_sct_sum, s.peo_cap_sum,
  s.peo_sct_latest, s.accession, c.doc_url`;

/** Verified cases where $100 invested at the table's start was worth less than `below` at the end.
 * Named lists feature notable companies (public float of at least $500M); statistics use every company. */
export const getPaidAnyway = cache(async (below = 50, limit = 100): Promise<ScreenCase[]> => sql<ScreenCase[]>`
  SELECT ${CASE_COLUMNS} FROM pvp_screen_ok s JOIN pvp_case c ON c.cik = s.cik AND c.verified AND NOT s.implausible
  WHERE s.notable AND s.tsr_value_of_100 < ${below} AND s.span_years >= 3 AND s.peo_sct_sum IS NOT NULL
  ORDER BY s.peo_sct_sum DESC LIMIT ${limit}`);

/** Verified cases where shareholders lost money but CEO pay "actually paid" still summed positive. */
export const getHeadsIWin = cache(async (limit = 100): Promise<ScreenCase[]> => sql<ScreenCase[]>`
  SELECT ${CASE_COLUMNS} FROM pvp_screen_ok s JOIN pvp_case c ON c.cik = s.cik AND c.verified AND NOT s.implausible
  WHERE s.notable AND s.tsr_value_of_100 < 100 AND s.peo_cap_sum > 0 AND s.span_years >= 3
  ORDER BY s.peo_cap_sum DESC LIMIT ${limit}`);

export const getScreenCase = cache(async (cik: number): Promise<ScreenCase | null> => {
  const rows = await sql<ScreenCase[]>`
    SELECT ${CASE_COLUMNS} FROM pvp_screen_ok s JOIN pvp_case c ON c.cik = s.cik AND c.verified AND NOT s.implausible
    WHERE s.cik = ${cik}`;
  return rows[0] ?? null;
});

export type ScreenYear = {
  frame: string;
  period_end: string;
  peo_sct: number | null;
  peo_cap: number | null;
  tsr: number | null;
  peer_tsr: number | null;
  other_neo_avg_sct: number | null;
};

/** The case's own filing table, year by year (only facts from that filing's accession). */
export const getScreenYears = cache(async (cik: number, accession: string): Promise<ScreenYear[]> => sql<ScreenYear[]>`
  SELECT frame, max(period_end)::text AS period_end,
         max(value) FILTER (WHERE concept = 'PeoTotalCompAmt') AS peo_sct,
         max(value) FILTER (WHERE concept = 'PeoActuallyPaidCompAmt') AS peo_cap,
         max(value) FILTER (WHERE concept = 'TotalShareholderRtnAmt') AS tsr,
         max(value) FILTER (WHERE concept = 'PeerGroupTotalShareholderRtnAmt') AS peer_tsr,
         max(value) FILTER (WHERE concept = 'NonPeoNeoAvgTotalCompAmt') AS other_neo_avg_sct
  FROM xbrl_frame_fact
  WHERE cik = ${cik} AND accession = ${accession}
  GROUP BY frame ORDER BY frame`);

export type ScreenStats = {
  companies: number;
  flagged: number;
  full_tables: number;
  lost_money: number;
  lost_half: number;
  median_pay_lost: number | null;
  median_pay_gained: number | null;
  median_pay_lost_half: number | null;
  p25_pay_lost: number | null;
  p75_pay_lost: number | null;
  p25_pay_gained: number | null;
  p75_pay_gained: number | null;
  lost_cap_positive: number;
  lost_with_cap: number;
  median_cap_share_lost: number | null;
  median_tsr_lost: number | null;
  latest_year: string | null;
};

/**
 * Pay per year compares like with like: companies whose own table covers at least three years with a
 * CEO figure for every year, CEO reported pay averaged over those years.
 */
export const getScreenStats = cache(async (): Promise<ScreenStats> => {
  const rows = await sql<ScreenStats[]>`
    WITH full_t AS (
      SELECT *, peo_sct_sum / peo_years AS pay_per_year FROM pvp_screen_ok
      WHERE span_years >= 3 AND peo_years = span_years AND peo_sct_sum IS NOT NULL AND NOT implausible
    )
    SELECT (SELECT count(*)::int FROM pvp_screen) AS companies,
           (SELECT count(*)::int FROM pvp_screen_ok WHERE implausible) AS flagged,
           count(*)::int AS full_tables,
           count(*) FILTER (WHERE tsr_value_of_100 < 100)::int AS lost_money,
           count(*) FILTER (WHERE tsr_value_of_100 < 50)::int AS lost_half,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY pay_per_year) FILTER (WHERE tsr_value_of_100 < 100) AS median_pay_lost,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY pay_per_year) FILTER (WHERE tsr_value_of_100 >= 100) AS median_pay_gained,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY pay_per_year) FILTER (WHERE tsr_value_of_100 < 50) AS median_pay_lost_half,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY pay_per_year) FILTER (WHERE tsr_value_of_100 < 100) AS p25_pay_lost,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY pay_per_year) FILTER (WHERE tsr_value_of_100 < 100) AS p75_pay_lost,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY pay_per_year) FILTER (WHERE tsr_value_of_100 >= 100) AS p25_pay_gained,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY pay_per_year) FILTER (WHERE tsr_value_of_100 >= 100) AS p75_pay_gained,
           count(*) FILTER (WHERE tsr_value_of_100 < 100 AND peo_cap_sum > 0)::int AS lost_cap_positive,
           count(*) FILTER (WHERE tsr_value_of_100 < 100 AND peo_cap_sum IS NOT NULL)::int AS lost_with_cap,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY peo_cap_sum / nullif(peo_sct_sum, 0))
             FILTER (WHERE tsr_value_of_100 < 100 AND peo_cap_sum IS NOT NULL) AS median_cap_share_lost,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY tsr_value_of_100) FILTER (WHERE tsr_value_of_100 < 100)
             AS median_tsr_lost,
           max(latest_frame) AS latest_year
    FROM full_t`;
  return rows[0];
});

export type Parachute = {
  company_slug: string;
  company_name: string;
  full_name: string;
  role: string | null;
  exit_date: string | null;
  exit_type: string;
  basis: string;
  severance_cash: number | null;
  accelerated_equity_value: number | null;
  consulting_fees: number | null;
  other_exit_pay: number | null;
  total_exit_pay: number | null;
  notes: string | null;
  tenure_total_return: number | null;
  tenure_bench_total_return: number | null;
  tenure_annualized_excess: number | null;
  pay_total: number | null;
  source_urls: string[];
};

/** Exit packages with a disclosed amount, and the stock over the person's officer tenure. */
export const getParachutes = cache(async (): Promise<Parachute[]> => sql<Parachute[]>`
  SELECT c.slug AS company_slug, c.common_name AS company_name, p.full_name, x.role, x.exit_date::text, x.exit_type,
         x.basis, x.severance_cash, x.accelerated_equity_value, x.consulting_fees, x.other_exit_pay,
         coalesce(x.total_exit_pay, nullif(coalesce(x.severance_cash, 0) + coalesce(x.accelerated_equity_value, 0)
                  + coalesce(x.consulting_fees, 0) + coalesce(x.other_exit_pay, 0), 0)) AS total_exit_pay,
         x.notes, t.total_return AS tenure_total_return, t.bench_total_return AS tenure_bench_total_return,
         t.annualized_excess AS tenure_annualized_excess, pp.pay_total,
         (SELECT array_agg(DISTINCT sd.url) FROM evidence e JOIN source_document sd ON sd.id = e.source_document_id
          WHERE e.id = ANY(x.evidence_ids)) AS source_urls
  FROM executive_exit x
  JOIN person p ON p.id = x.person_id
  JOIN company c ON c.id = x.company_id
  JOIN benchmark b ON b.code = 'sp500'
  LEFT JOIN executive_tenure_performance t ON t.company_id = x.company_id AND t.person_id = x.person_id
   AND t.benchmark_id = b.id AND t.window_kind = 'tenure'
  LEFT JOIN executive_pay_performance pp ON pp.company_id = x.company_id AND pp.person_id = x.person_id
  WHERE x.basis = 'actual'
  ORDER BY total_exit_pay DESC NULLS LAST, x.exit_date DESC`);

export type FailingUp = {
  id: string;
  person_name: string;
  from_company: string;
  from_ticker: string | null;
  from_role: string;
  from_start: string | null;
  from_end: string | null;
  exit_description: string | null;
  from_value_of_100: number;
  comparison_name: string;
  comparison_value_of_100: number;
  period_start: string | null;
  period_end: string | null;
  exit_pay_total: number | null;
  exit_pay_description: string | null;
  to_company: string;
  to_ticker: string | null;
  to_role: string;
  to_start: string | null;
  pay: { fiscal_year: number; total: number }[];
  notes: string | null;
  source_urls: string[];
};

/** Largest shortfall against the comparison first. */
export const getFailingUp = cache(async (): Promise<FailingUp[]> => sql<FailingUp[]>`
  SELECT id, person_name, from_company, from_ticker, from_role, from_start, from_end, exit_description,
         from_value_of_100, comparison_name, comparison_value_of_100, period_start::text, period_end::text,
         exit_pay_total, exit_pay_description, to_company, to_ticker, to_role, to_start, pay, notes, source_urls
  FROM failing_up_case ORDER BY comparison_value_of_100 - from_value_of_100 DESC`);

export type ExecSale = {
  company_slug: string;
  company_name: string;
  full_name: string;
  titles: string[];
  window_start: string;
  window_end: string;
  is_current: boolean;
  filings: number;
  proceeds: number;
  avg_price_adj: number | null;
  end_close_adj: number | null;
  value_at_end: number | null;
  plan_share: number | null;
  total_return: number | null;
  bench_total_return: number | null;
  pay_total: number | null;
};

/** Executives' open-market stock sales during their officer tenure, largest first. */
export const getExecutiveSales = cache(async (): Promise<ExecSale[]> => sql<ExecSale[]>`
  SELECT c.slug AS company_slug, c.common_name AS company_name, p.full_name, t.titles, s.window_start::text,
         s.window_end::text, t.is_current, s.filings, s.proceeds, s.avg_price_adj, s.end_close_adj, s.value_at_end,
         s.plan_share, t.total_return, t.bench_total_return, pp.pay_total
  FROM executive_sales s
  JOIN person p ON p.id = s.person_id
  JOIN company c ON c.id = s.company_id
  JOIN benchmark b ON b.code = 'sp500'
  JOIN executive_tenure_performance t ON t.company_id = s.company_id AND t.person_id = s.person_id
   AND t.benchmark_id = b.id AND t.window_kind = 'tenure'
  LEFT JOIN executive_pay_performance pp ON pp.company_id = s.company_id AND pp.person_id = s.person_id
  WHERE s.proceeds > 0
  ORDER BY s.proceeds DESC`);

export type Chute = {
  key: string;
  company: string;
  ticker: string | null;
  person: string;
  role: string;
  context: "termination" | "resignation" | "retirement" | "merger" | "other";
  exit_type: string;
  exit_words: string | null;
  exit_date: string | null;
  tenure_start: string | null;
  basis: "actual" | "estimated";
  severance_cash: number | null;
  bonus: number | null;
  equity: number | null;
  pension_deferred: number | null;
  benefits_other: number | null;
  consulting: number | null;
  tax_gross_up: number | null;
  total: number | null;
  total_is_stated: boolean;
  value_of_100: number | null;
  comparison_name: string | null;
  comparison_value_of_100: number | null;
  clawback_or_forfeiture: string | null;
  notes: string | null;
  source_urls: string[];
};

const CONTEXT_OF = sql`CASE x.exit_type WHEN 'terminated_without_cause' THEN 'termination' WHEN 'terminated_for_cause' THEN 'termination'
  WHEN 'mutual' THEN 'termination' WHEN 'resigned' THEN 'resignation' WHEN 'retired' THEN 'retirement'
  WHEN 'change_in_control' THEN 'merger' ELSE 'other' END`;

/**
 * Every researched exit package: the deep-research cases across US companies plus the exits of the
 * six fully researched companies (whose stock figure is our own tenure return vs SPY, as $100).
 */
export const getAllChutes = cache(async (): Promise<Chute[]> => sql<Chute[]>`
  SELECT g.id AS key, g.company_name AS company, g.ticker, g.person_name AS person, g.role, g.context, g.exit_type,
         g.exit_words, g.tenure_end AS exit_date, g.tenure_start, g.basis, g.severance_cash, g.bonus, g.equity,
         g.pension_deferred, g.benefits_other, g.consulting, g.tax_gross_up, g.total, g.total_is_stated,
         g.value_of_100, g.comparison_name, g.comparison_value_of_100, g.clawback_or_forfeiture, g.notes, g.source_urls
  FROM golden_parachute g
  UNION ALL
  SELECT 'x' || x.id, c.common_name, s.symbol, p.full_name, coalesce(x.role, ''), ${CONTEXT_OF}, x.exit_type, NULL,
         x.exit_date::text, t.tenure_start::text, x.basis, x.severance_cash, NULL, x.accelerated_equity_value, NULL,
         x.other_exit_pay, x.consulting_fees, NULL,
         coalesce(x.total_exit_pay, nullif(coalesce(x.severance_cash, 0) + coalesce(x.accelerated_equity_value, 0)
                  + coalesce(x.consulting_fees, 0) + coalesce(x.other_exit_pay, 0), 0)),
         x.total_exit_pay IS NOT NULL,
         CASE WHEN t.total_return IS NOT NULL THEN 100 * (1 + t.total_return) END, 'S&P 500 (SPY)',
         CASE WHEN t.bench_total_return IS NOT NULL THEN 100 * (1 + t.bench_total_return) END, NULL, x.notes,
         coalesce((SELECT array_agg(DISTINCT sd.url) FROM evidence e JOIN source_document sd ON sd.id = e.source_document_id
                   WHERE e.id = ANY(x.evidence_ids)), '{}')
  FROM executive_exit x
  JOIN person p ON p.id = x.person_id
  JOIN company c ON c.id = x.company_id
  LEFT JOIN security s ON s.company_id = c.id AND s.is_primary
  JOIN benchmark b ON b.code = 'sp500'
  LEFT JOIN executive_tenure_performance t ON t.company_id = x.company_id AND t.person_id = x.person_id
   AND t.benchmark_id = b.id AND t.window_kind = 'tenure'
  WHERE x.basis = 'actual'`);
