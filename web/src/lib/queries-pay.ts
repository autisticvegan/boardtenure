import "server-only";
import { cache } from "react";
import { sql } from "./db";
import type { Precision } from "./format";

/**
 * Executive pay (proxy Summary Compensation Table) against the stock over the same window.
 * Metrics come from the executive_pay_performance view; see docs/methodology.md "Executive pay".
 */
export type ExecPay = {
  person_id: number;
  person_slug: string;
  full_name: string;
  titles: string[];
  is_current: boolean;
  tenure_start: string | null;
  tenure_start_precision: Precision;
  tenure_end: string | null;
  tenure_end_precision: Precision | null;
  status: string;
  start_anchor_date: string | null;
  start_anchor_reason: string | null;
  end_anchor_date: string | null;
  calendar_days: number | null;
  total_return: number | null;
  bench_total_return: number | null;
  relative_return_pp: number | null;
  annualized_excess: number | null;
  return_low: number | null;
  return_high: number | null;
  start_market_cap: number | null;
  start_shares_as_of: string | null;
  pay_years: number | null;
  pay_total: number | null;
  equity_awards: number | null;
  first_pay_year: number | null;
  last_pay_year: number | null;
  pay_per_year: number | null;
  excess_wealth: number | null;
  excess_wealth_per_pay_dollar: number | null;
  has_seat: boolean;
  // The whole tenure (through the latest close for current executives), for context.
  tenure_status: string;
  tenure_end_anchor: string | null;
  tenure_total_return: number | null;
  tenure_bench_total_return: number | null;
  tenure_annualized_excess: number | null;
};

export const getExecPay = cache(async (companyId: number): Promise<ExecPay[]> => sql<ExecPay[]>`
  SELECT epp.person_id, p.slug AS person_slug, p.full_name, epp.titles, epp.is_current,
         epp.tenure_start::text, epp.tenure_start_precision, epp.tenure_end::text, epp.tenure_end_precision,
         epp.status, epp.start_anchor_date::text, epp.start_anchor_reason, epp.end_anchor_date::text,
         epp.calendar_days, epp.total_return, epp.bench_total_return, epp.relative_return_pp, epp.annualized_excess,
         epp.return_low, epp.return_high, epp.start_market_cap, epp.start_shares_as_of::text,
         epp.pay_years, epp.pay_total, epp.equity_awards, epp.first_pay_year, epp.last_pay_year, epp.pay_per_year,
         epp.excess_wealth, epp.excess_wealth_per_pay_dollar,
         EXISTS (SELECT 1 FROM board_membership m WHERE m.company_id = epp.company_id AND m.person_id = epp.person_id)
           AS has_seat,
         t.status AS tenure_status, t.end_anchor_date::text AS tenure_end_anchor, t.total_return AS tenure_total_return,
         t.bench_total_return AS tenure_bench_total_return, t.annualized_excess AS tenure_annualized_excess
  FROM executive_pay_performance epp
  JOIN person p ON p.id = epp.person_id
  LEFT JOIN executive_tenure_performance t ON t.company_id = epp.company_id AND t.person_id = epp.person_id
   AND t.benchmark_id = epp.benchmark_id AND t.window_kind = 'tenure'
  WHERE epp.company_id = ${companyId}
  ORDER BY epp.pay_total DESC NULLS LAST, p.full_name`);

export type ExecPayYear = {
  person_id: number;
  fiscal_year: number;
  listed_title: string | null;
  salary: number;
  bonus: number;
  stock_awards: number;
  option_awards: number;
  non_equity_incentive: number;
  pension_nqdc: number;
  all_other: number;
  total: number;
  notes: string | null;
  source_url: string;
  source_form: string;
  filed_on: string;
  year_status: string | null;
  start_anchor_date: string | null;
  end_anchor_date: string | null;
  year_total_return: number | null;
  year_bench_total_return: number | null;
  year_relative_pp: number | null;
  in_pay_window: boolean;
};

export const getExecPayYears = cache(async (companyId: number): Promise<ExecPayYear[]> => sql<ExecPayYear[]>`
  SELECT ec.person_id, ec.fiscal_year, ec.listed_title, ec.salary, ec.bonus, ec.stock_awards, ec.option_awards,
         ec.non_equity_incentive, ec.pension_nqdc, ec.all_other, ec.total, ec.notes, ec.source_url, ec.source_form,
         ec.filed_on::text,
         y.status AS year_status, y.start_anchor_date::text, y.end_anchor_date::text,
         y.total_return AS year_total_return, y.bench_total_return AS year_bench_total_return,
         y.relative_return_pp AS year_relative_pp,
         coalesce(ec.fiscal_year BETWEEN epp.first_pay_year AND epp.last_pay_year, false) AS in_pay_window
  FROM executive_comp_latest ec
  JOIN benchmark b ON b.code = 'sp500'
  LEFT JOIN executive_year_performance y ON y.company_id = ec.company_id AND y.person_id = ec.person_id
   AND y.fiscal_year = ec.fiscal_year AND y.benchmark_id = b.id
  LEFT JOIN executive_pay_performance epp ON epp.company_id = ec.company_id AND epp.person_id = ec.person_id
  WHERE ec.company_id = ${companyId}
  ORDER BY ec.person_id, ec.fiscal_year DESC`);

export type PvpYear = {
  fiscal_year: number;
  peos: { person_id: number; full_name: string; person_slug: string; sct_total: number | null; cap: number | null }[];
  non_peo_avg_sct_total: number | null;
  non_peo_avg_cap: number | null;
  tsr_value_of_100: number | null;
  peer_tsr_value_of_100: number | null;
  peer_group: string | null;
  tsr_base_date: string | null;
  source_url: string;
  filed_on: string;
  our_tsr_value_of_100: number | null;
};

export const getPayVsPerformance = cache(async (companyId: number): Promise<PvpYear[]> => sql<PvpYear[]>`
  SELECT v.fiscal_year,
         coalesce((SELECT json_agg(json_build_object('person_id', pp.person_id, 'full_name', p.full_name,
                                                     'person_slug', p.slug, 'sct_total', pp.sct_total, 'cap', pp.cap)
                                   ORDER BY pp.sct_total DESC)
                   FROM pay_vs_performance_peo pp JOIN person p ON p.id = pp.person_id
                   WHERE pp.source_document_id = v.source_document_id AND pp.fiscal_year = v.fiscal_year), '[]')
           AS peos,
         v.non_peo_avg_sct_total, v.non_peo_avg_cap, v.tsr_value_of_100, v.peer_tsr_value_of_100, v.peer_group,
         v.tsr_base_date::text, v.source_url, v.filed_on::text,
         (SELECT 100 * e.tr_index / b.tr_index FROM security s
            JOIN LATERAL (SELECT tr_index FROM price_daily WHERE security_id = s.id AND trade_date <= v.tsr_base_date
                          ORDER BY trade_date DESC LIMIT 1) b ON true
            JOIN LATERAL (SELECT tr_index FROM price_daily WHERE security_id = s.id
                            AND trade_date <= coalesce(v.fiscal_year_end, make_date(v.fiscal_year, 12, 31))
                          ORDER BY trade_date DESC LIMIT 1) e ON true
          WHERE s.company_id = v.company_id AND s.is_primary) AS our_tsr_value_of_100
  FROM pay_vs_performance_latest v
  WHERE v.company_id = ${companyId}
  ORDER BY v.fiscal_year DESC`);

/** The company's whole pay window: every counted executive-year, the stock vs SPY over those years. */
export type PaySpan = {
  first_year: number;
  last_year: number;
  start_anchor: string | null;
  start_anchor_reason: string | null;
  end_anchor: string | null;
  total_return: number | null;
  bench_total_return: number | null;
  annualized_excess: number | null;
  pay_total: number;
  people: number;
  exec_years: number;
  start_market_cap: number | null;
};

const SPAN_COLUMNS = sql`
  cp.first_pay_year AS first_year, cp.last_pay_year AS last_year, cp.start_anchor_date::text AS start_anchor,
  cp.start_anchor_reason, cp.end_anchor_date::text AS end_anchor, cp.total_return, cp.bench_total_return,
  cp.annualized_excess, cp.pay_total, cp.people, cp.exec_years, cp.start_market_cap`;

export const getPaySpan = cache(async (companyId: number): Promise<PaySpan | null> => {
  const rows = await sql<PaySpan[]>`
    SELECT ${SPAN_COLUMNS} FROM company_pay_performance cp JOIN benchmark b ON b.id = cp.benchmark_id
    WHERE b.code = 'sp500' AND cp.company_id = ${companyId}`;
  return rows[0] ?? null;
});

export type CompanyPay = PaySpan & {
  company_id: number; slug: string; common_name: string; symbol: string | null;
  median_pay_per_year: number | null; ceos: string[];
};

/** One row per company with executive pay on file, for the cross-company pay page. */
export const getPayCompaniesOverview = cache(async (): Promise<CompanyPay[]> => sql<CompanyPay[]>`
  SELECT c.id AS company_id, c.slug, c.common_name, s.symbol, ${SPAN_COLUMNS},
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ec.total) FROM executive_comp_latest ec
            WHERE ec.company_id = c.id AND ec.fiscal_year BETWEEN cp.first_pay_year AND cp.last_pay_year) AS median_pay_per_year,
         coalesce((SELECT array_agg(DISTINCT p.full_name) FROM pay_vs_performance_peo pp
                     JOIN pay_vs_performance v USING (source_document_id, fiscal_year)
                     JOIN person p ON p.id = pp.person_id WHERE v.company_id = c.id), '{}') AS ceos
  FROM company_pay_performance cp
  JOIN benchmark b ON b.id = cp.benchmark_id AND b.code = 'sp500'
  JOIN company c ON c.id = cp.company_id
  LEFT JOIN security s ON s.company_id = c.id AND s.is_primary
  ORDER BY c.common_name`);

export type ExecPayAcross = ExecPay & {
  company_slug: string; company_name: string; symbol: string | null; is_ceo: boolean;
};

/** Every executive pay window across companies. is_ceo: a PEO in any pay-versus-performance table,
 * or a chief-executive title. */
export const getAllExecPay = cache(async (): Promise<ExecPayAcross[]> => sql<ExecPayAcross[]>`
  SELECT epp.person_id, p.slug AS person_slug, p.full_name, epp.titles, epp.is_current,
         epp.tenure_start::text, epp.tenure_start_precision, epp.tenure_end::text, epp.tenure_end_precision,
         epp.status, epp.start_anchor_date::text, epp.start_anchor_reason, epp.end_anchor_date::text,
         epp.calendar_days, epp.total_return, epp.bench_total_return, epp.relative_return_pp, epp.annualized_excess,
         epp.return_low, epp.return_high, epp.start_market_cap, epp.start_shares_as_of::text,
         epp.pay_years, epp.pay_total, epp.equity_awards, epp.first_pay_year, epp.last_pay_year, epp.pay_per_year,
         epp.excess_wealth, epp.excess_wealth_per_pay_dollar,
         EXISTS (SELECT 1 FROM board_membership m WHERE m.company_id = epp.company_id AND m.person_id = epp.person_id)
           AS has_seat,
         NULL::text AS tenure_status, NULL::text AS tenure_end_anchor, NULL::float AS tenure_total_return,
         NULL::float AS tenure_bench_total_return, NULL::float AS tenure_annualized_excess,
         c.slug AS company_slug, c.common_name AS company_name, s.symbol,
         (EXISTS (SELECT 1 FROM pay_vs_performance_peo pp JOIN pay_vs_performance v USING (source_document_id, fiscal_year)
                  WHERE v.company_id = epp.company_id AND pp.person_id = epp.person_id)
          OR EXISTS (SELECT 1 FROM unnest(epp.titles) t WHERE t ~* '(chief executive|\mceo\M)')) AS is_ceo
  FROM executive_pay_performance epp
  JOIN person p ON p.id = epp.person_id
  JOIN company c ON c.id = epp.company_id
  LEFT JOIN security s ON s.company_id = c.id AND s.is_primary
  WHERE epp.pay_years > 0
  ORDER BY epp.pay_per_year DESC NULLS LAST`);

/** The single largest reported executive-year, to flag when one award dominates the totals. */
export const getBiggestExecYear = cache(async () => {
  const rows = await sql<{ full_name: string; company_name: string; fiscal_year: number; total: number }[]>`
    SELECT p.full_name, c.common_name AS company_name, ec.fiscal_year, ec.total
    FROM executive_comp_latest ec JOIN person p ON p.id = ec.person_id JOIN company c ON c.id = ec.company_id
    JOIN company_pay_performance cp ON cp.company_id = ec.company_id
    WHERE ec.fiscal_year BETWEEN cp.first_pay_year AND cp.last_pay_year
    ORDER BY ec.total DESC LIMIT 1`;
  return rows[0] ?? null;
});

/** Companies with executive pay on file, for links from the company and director pages. */
export const getPayCompanies = cache(async (): Promise<Set<number>> => {
  const rows = await sql<{ company_id: number }[]>`SELECT DISTINCT company_id FROM executive_comp`;
  return new Set(rows.map((r) => r.company_id));
});

export const getPersonExecPay = cache(async (personId: number) => sql<{
  company_slug: string; company_name: string; pay_total: number | null; pay_years: number | null;
  annualized_excess: number | null; relative_return_pp: number | null;
}[]>`
  SELECT c.slug AS company_slug, c.common_name AS company_name, epp.pay_total, epp.pay_years,
         epp.annualized_excess, epp.relative_return_pp
  FROM executive_pay_performance epp JOIN company c ON c.id = epp.company_id
  WHERE epp.person_id = ${personId}`);

/** Market-wide: same-CEO year-over-year pay changes against the stock (pay_asymmetry_stat). */
export type AsymTerm = {
  up: number; up_se: number; down: number; down_se: number; diff: number; diff_se: number;
  pay_if_up10: number; pay_if_down10: number;
};
export type AsymFit = { n: number; companies?: number; terms?: Record<string, AsymTerm> };
export type AsymBucket = {
  lo: number | null; hi: number | null; n: number;
  median_change: number | null; share_up: number | null; median_pay: number | null;
};
export type PayAsymmetry = {
  sample: { pairs: number; companies: number; first_year: number; last_year: number; panel_companies: number };
  overall: AsymBucket;
  buckets_same: AsymBucket[];
  buckets_prior: AsymBucket[];
  same_year: AsymFit;
  both_years: AsymFit;
  two_year: AsymFit;
  luck: AsymFit;
};

export const getPayAsymmetry = cache(async (): Promise<PayAsymmetry | null> => {
  const rows = await sql<{ key: string; value: unknown }[]>`SELECT key, value FROM pay_asymmetry_stat`;
  if (rows.length === 0) return null;
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as PayAsymmetry;
});
