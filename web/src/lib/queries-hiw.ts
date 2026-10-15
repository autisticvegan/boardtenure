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
  to_kind: "executive" | "director";
  from_cik: number | null;
  to_cik: number | null;
  other_comparisons: { name: string; value_of_100: number }[];
  pay: { fiscal_year: number; total: number }[];
  notes: string | null;
  source_urls: string[];
};

/** Largest shortfall against the comparison first. */
export const getFailingUp = cache(async (): Promise<FailingUp[]> => sql<FailingUp[]>`
  SELECT id, person_name, from_company, from_ticker, from_role, from_start, from_end, exit_description,
         from_value_of_100, comparison_name, comparison_value_of_100, period_start::text, period_end::text,
         exit_pay_total, exit_pay_description, to_company, to_ticker, to_role, to_start, to_kind, other_comparisons, pay, notes,
         source_urls, from_cik, to_cik
  FROM failing_up_case ORDER BY comparison_value_of_100 - from_value_of_100 DESC`);

export type ExecSale = {
  company_slug: string;
  company_cik: string | null;
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
  SELECT c.slug AS company_slug, c.cik AS company_cik, c.common_name AS company_name, p.full_name, t.titles,
         s.window_start::text,
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
  cik: number | null;
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
export const getAllChutes = cache(async (): Promise<Chute[]> => dedupeChutes(await sql<Chute[]>`
  SELECT g.id AS key, nullif(regexp_replace(g.company_cik, '\D', '', 'g'), '')::bigint AS cik, g.company_name AS company,
         g.ticker, g.person_name AS person, g.role, g.context, g.exit_type,
         g.exit_words, g.tenure_end AS exit_date, g.tenure_start, g.basis, g.severance_cash, g.bonus, g.equity,
         g.pension_deferred, g.benefits_other, g.consulting, g.tax_gross_up, g.total, g.total_is_stated,
         g.value_of_100, g.comparison_name, g.comparison_value_of_100, g.clawback_or_forfeiture, g.notes, g.source_urls
  FROM golden_parachute g
  UNION ALL
  SELECT 'x' || x.id, nullif(regexp_replace(c.cik, '\D', '', 'g'), '')::bigint, c.common_name, s.symbol, p.full_name, coalesce(x.role, ''), ${CONTEXT_OF}, x.exit_type, NULL,
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
  WHERE x.basis = 'actual'`));

/** One receipt per person and company: research slices can overlap (a CEO pushed out ahead of a merger).
 * Prefer what was actually paid over an estimate, then the more fully itemised record. */
function dedupeChutes(rows: Chute[]): Chute[] {
  const key = (c: Chute) => `${c.person.trim().split(/\s+/).pop()?.toLowerCase()}|${c.company.toLowerCase().split(/[\s,.]+/)[0]}`;
  const score = (c: Chute) => (c.basis === "actual" ? 2 : 0) + (c.value_of_100 != null ? 1 : 0);
  const best = new Map<string, Chute>();
  for (const c of rows) {
    const k = key(c);
    const cur = best.get(k);
    if (!cur || score(c) > score(cur)) best.set(k, c);
  }
  return [...best.values()];
}

export type RaiseAnyway = {
  cik: number;
  entity_name: string;
  tickers: string | null;
  peo_name: string;
  fiscal_year: number;
  ret: number;
  sct_prev: number;
  sct: number;
  doc_url: string | null;
};

/** The same CEO, paid more than the year before, in a year the stock fell at least `drop`
 *  (company's own pay-versus-performance table; well-known companies only). */
export const getRaisesAnyway = cache(async (drop = 0.3, limit = 24): Promise<RaiseAnyway[]> => sql<RaiseAnyway[]>`
  SELECT c.cik, s.entity_name, s.tickers, coalesce(full_name.n, c.peo_name) AS peo_name,
         extract(year FROM c.period_end)::int AS fiscal_year, c.ret, c.sct_prev::float8 AS sct_prev,
         c.sct::float8 AS sct, f.doc_url
  FROM pay_change c
  JOIN pvp_screen_ok s ON s.cik = c.cik AND s.notable AND NOT s.implausible
  LEFT JOIN pvp_panel_filing f ON f.cik = c.cik
  -- "Mr. Singh": the longest name the same filing tags with that surname
  LEFT JOIN LATERAL (
    SELECT p.peo_name AS n FROM pvp_panel_peo p
    WHERE p.cik = c.cik AND p.peo_name IS NOT NULL
      AND lower(regexp_replace(p.peo_name, '^.*\s', '')) = lower(regexp_replace(c.peo_name, '^.*\s', ''))
      AND p.peo_name !~* '^(mr|ms|mrs|dr)\.?\s'
    ORDER BY length(p.peo_name) DESC LIMIT 1) full_name ON true
  WHERE c.ret <= ${-drop} AND c.sct > c.sct_prev AND NOT c.new_ceo_base
  ORDER BY c.sct - c.sct_prev DESC
  LIMIT ${limit}`);

export type PayRatio = {
  cik: number;
  entity_name: string;
  tickers: string | null;
  fiscal_year: number | null;
  ratio: number;
  ceo_pay: number;
  median_pay: number;
  doc_url: string;
  quote: string;
};

/** CEO pay ratios from the latest proxy, verified (CEO pay / median pay reproduce the stated ratio),
 *  at well-known companies. */
export const getPayRatios = cache(async (): Promise<PayRatio[]> => sql<PayRatio[]>`
  SELECT r.cik, s.entity_name, s.tickers, r.fiscal_year, r.ratio, r.ceo_pay::float8 AS ceo_pay,
         r.median_pay::float8 AS median_pay, r.doc_url, r.quote
  FROM pay_ratio r JOIN pvp_screen_ok s ON s.cik = r.cik AND s.notable AND NOT s.implausible
  WHERE r.verified
  ORDER BY r.ratio DESC`);

export const getPayRatioStats = cache(async () => {
  const rows = await sql<{ n: number; n_all: number; median: number; median_all: number; median_worker: number }[]>`
    SELECT count(*) FILTER (WHERE s.notable)::int AS n, count(*)::int AS n_all,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.ratio) FILTER (WHERE s.notable) AS median,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.ratio) AS median_all,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY r.median_pay) FILTER (WHERE s.notable) AS median_worker
    FROM pay_ratio r JOIN pvp_screen_ok s ON s.cik = r.cik AND NOT s.implausible
    WHERE r.verified`;
  return rows[0];
});
