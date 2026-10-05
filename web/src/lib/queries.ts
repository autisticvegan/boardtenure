import "server-only";
import { cache } from "react";
import { sql } from "./db";
import type { Precision } from "./format";
import { normalizeAndAlign, type ChartPoint } from "./series";

export type Perf = {
  status: "ok" | "approximate" | "too_short" | "no_price_history" | "unknown_dates";
  is_open: boolean;
  start_anchor_date: string | null;
  start_anchor_reason: "join_date" | "first_trade" | "join_window" | null;
  end_anchor_date: string | null;
  end_anchor_reason: string | null;
  start_close: number | null;
  end_close: number | null;
  calendar_days: number | null;
  trading_days: number | null;
  total_return: number | null;
  price_return: number | null;
  annualized_return: number | null;
  bench_total_return: number | null;
  bench_annualized_return: number | null;
  relative_return_pp: number | null;
  excess_return: number | null;
  max_drawdown: number | null;
  mdd_peak_date: string | null;
  mdd_trough_date: string | null;
  return_low: number | null;
  return_high: number | null;
  data_through: string | null;
  methodology_version: string;
};

export type Role = {
  role: "chair" | "executive_chair" | "vice_chair" | "lead_independent_director" | "executive_director";
  officer_title: string | null;
  is_current: boolean;
  start_date: string | null;
  start_precision: Precision;
  end_date: string | null;
  end_precision: Precision | null;
};

export type Committee = { committee: string; role: "member" | "chair" };

export type Membership = {
  membership_id: number;
  person_id: number;
  person_slug: string;
  full_name: string;
  status: "current" | "former";
  start_date: string | null;
  start_precision: Precision;
  start_basis: string | null;
  end_date: string | null;
  end_precision: Precision | null;
  end_basis: string | null;
  end_reason: string | null;
  confidence: "high" | "medium" | "low";
  review_status: string;
  roles: Role[];
  is_independent: boolean | null;
  committees: Committee[];
  perf: Perf | null;
};

export type CompanyHeader = {
  id: number;
  slug: string;
  cik: string | null;
  legal_name: string;
  common_name: string;
  status: string;
  ipo_date: string | null;
  sector: string | null;
  industry: string | null;
  website: string | null;
  security_id: number | null;
  symbol: string | null;
  exchange: string | null;
  last_close: number | null;
  last_date: string | null;
  prev_close: number | null;
};

const PERF_JSON = sql`
  CASE WHEN tp.membership_id IS NULL THEN NULL ELSE json_build_object(
    'status', tp.status, 'is_open', tp.is_open,
    'start_anchor_date', tp.start_anchor_date, 'start_anchor_reason', tp.start_anchor_reason,
    'end_anchor_date', tp.end_anchor_date, 'end_anchor_reason', tp.end_anchor_reason,
    'start_close', tp.start_close, 'end_close', tp.end_close,
    'calendar_days', tp.calendar_days, 'trading_days', tp.trading_days,
    'total_return', tp.total_return, 'price_return', tp.price_return,
    'annualized_return', tp.annualized_return, 'bench_total_return', tp.bench_total_return,
    'bench_annualized_return', tp.bench_annualized_return, 'relative_return_pp', tp.relative_return_pp,
    'excess_return', tp.excess_return, 'max_drawdown', tp.max_drawdown,
    'mdd_peak_date', tp.mdd_peak_date, 'mdd_trough_date', tp.mdd_trough_date,
    'return_low', tp.return_low, 'return_high', tp.return_high,
    'data_through', tp.data_through, 'methodology_version', tp.methodology_version) END`;

const MEMBERSHIP_COLUMNS = sql`
  m.id AS membership_id, p.id AS person_id, p.slug AS person_slug, p.full_name,
  m.status, m.start_date, m.start_precision, m.start_basis, m.end_date, m.end_precision, m.end_basis,
  m.end_reason, m.confidence, m.review_status,
  coalesce((SELECT json_agg(json_build_object(
              'role', r.role, 'officer_title', r.officer_title, 'is_current', r.is_current,
              'start_date', r.start_date, 'start_precision', r.start_precision,
              'end_date', r.end_date, 'end_precision', r.end_precision)
            ORDER BY r.start_date NULLS FIRST)
            FROM board_role r WHERE r.membership_id = m.id), '[]') AS roles,
  ind.is_independent, coalesce(snap.committees, '[]') AS committees,
  ${PERF_JSON} AS perf`;

const MEMBERSHIP_JOINS = sql`
  JOIN person p ON p.id = m.person_id
  -- Committees: current directors as of the company's latest roster; former directors as of their last one.
  LEFT JOIN LATERAL (
    SELECT bsm.committees FROM board_snapshot_member bsm
    JOIN board_snapshot bs ON bs.id = bsm.snapshot_id
    WHERE bsm.membership_id = m.id
      AND (m.status = 'former' OR bs.as_of_date = (SELECT max(as_of_date) FROM board_snapshot WHERE company_id = m.company_id))
    ORDER BY bs.as_of_date DESC LIMIT 1) snap ON true
  -- Independence: the open determination for current seats, the last one for former seats.
  LEFT JOIN LATERAL (
    SELECT bi.is_independent FROM board_independence bi WHERE bi.membership_id = m.id
    ORDER BY (bi.end_date IS NULL) DESC, bi.end_date DESC NULLS LAST LIMIT 1) ind ON true
  LEFT JOIN tenure_performance tp
    ON tp.membership_id = m.id AND tp.benchmark_id = (SELECT id FROM benchmark WHERE is_default)`;

export const getCompany = cache(async (slug: string): Promise<CompanyHeader | null> => {
  const [row] = await sql<CompanyHeader[]>`
    SELECT c.id, c.slug, c.cik, c.legal_name, c.common_name, c.status, c.ipo_date, c.sector, c.industry,
           c.website, s.id AS security_id, s.symbol, s.exchange,
           lp.close AS last_close, lp.trade_date AS last_date, pp.close AS prev_close
    FROM company c
    LEFT JOIN security s ON s.company_id = c.id AND s.is_primary
    LEFT JOIN LATERAL (SELECT close, trade_date FROM price_daily WHERE security_id = s.id
                       ORDER BY trade_date DESC LIMIT 1) lp ON true
    LEFT JOIN LATERAL (SELECT close FROM price_daily WHERE security_id = s.id AND trade_date < lp.trade_date
                       ORDER BY trade_date DESC LIMIT 1) pp ON true
    WHERE c.slug = ${slug.toLowerCase()}`;
  return row ?? null;
});

export const getBoard = cache(async (companyId: number): Promise<Membership[]> => {
  return sql<Membership[]>`
    SELECT ${MEMBERSHIP_COLUMNS}
    FROM board_membership m ${MEMBERSHIP_JOINS}
    WHERE m.company_id = ${companyId} AND m.seat_type = 'director'
    ORDER BY m.status = 'current' DESC, m.start_date NULLS FIRST, p.full_name`;
});

export type BoardEvent = {
  id: number;
  event_type: "BOARD_JOIN" | "BOARD_LEAVE" | "ROLE_CHANGE" | "BOARD_SIZE_CHANGE" | "COMMITTEE_CHANGE";
  event_date: string | null;
  event_date_precision: Precision;
  announced_date: string | null;
  details: Record<string, unknown>;
  person_slug: string | null;
  full_name: string | null;
  confidence: string;
};

export const getBoardEvents = cache(async (companyId: number): Promise<BoardEvent[]> => {
  return sql<BoardEvent[]>`
    SELECT e.id, e.event_type, e.event_date, e.event_date_precision, e.announced_date, e.details,
           p.slug AS person_slug, p.full_name, e.confidence
    FROM board_event e LEFT JOIN person p ON p.id = e.person_id
    WHERE e.company_id = ${companyId}
    ORDER BY e.event_date DESC NULLS LAST, e.id DESC`;
});

export type Coverage = {
  scope: "current_board" | "board_history";
  period_start: string;
  period_end: string;
  level: "complete" | "partial" | "minimal";
  method: string;
  notes: string | null;
  assessed_at: string;
};

export const getCoverage = cache(async (companyId: number): Promise<Coverage[]> => {
  return sql<Coverage[]>`
    SELECT scope, period_start, period_end, level, method, notes, (assessed_at AT TIME ZONE 'UTC')::date::text AS assessed_at
    FROM coverage_period WHERE company_id = ${companyId} ORDER BY scope, period_start`;
});

export type Benchmark = { id: number; code: string; name: string; security_id: number; proxy_note: string | null };

export const getDefaultBenchmark = cache(async (): Promise<Benchmark | null> => {
  const [b] = await sql<Benchmark[]>`
    SELECT id, code, name, security_id, proxy_note FROM benchmark WHERE is_default`;
  return b ?? null;
});

/**
 * Stock and benchmark cumulative total returns from `from`, aligned on the stock's
 * trading days and downsampled. Only derived returns leave the server, not raw bars.
 */
export async function getReturnSeries(
  securityId: number,
  benchmarkSecurityId: number | null,
  from: string,
  to: string,
  opts: { maxPoints?: number; baseDate?: string; keep?: string[] } = {},
): Promise<ChartPoint[]> {
  const rows = await sql<{ d: string; s: number; b: number | null }[]>`
    SELECT p.trade_date AS d, p.tr_index AS s, b.tr_index AS b
    FROM price_daily p
    LEFT JOIN price_daily b ON b.security_id = ${benchmarkSecurityId} AND b.trade_date = p.trade_date
    WHERE p.security_id = ${securityId} AND p.trade_date BETWEEN ${from} AND ${to} AND p.tr_index IS NOT NULL
    ORDER BY p.trade_date`;
  return normalizeAndAlign(rows, opts.maxPoints ?? 520, opts.baseDate, opts.keep);
}

export type PersonHeader = {
  id: number;
  slug: string;
  full_name: string;
  biography: string | null;
  birth_year_min: number | null;
  birth_year_max: number | null;
  sec_cik: string | null;
  affiliations: { organization_name: string; title: string | null; is_current: boolean; as_of_date: string }[];
};

export const getPerson = cache(async (slug: string): Promise<PersonHeader | null> => {
  const [row] = await sql<PersonHeader[]>`
    SELECT p.id, p.slug, p.full_name, p.biography, p.birth_year_min, p.birth_year_max,
           (SELECT value FROM person_identifier WHERE person_id = p.id AND scheme = 'sec_cik' LIMIT 1) AS sec_cik,
           coalesce((SELECT json_agg(json_build_object('organization_name', a.organization_name, 'title', a.title,
                       'is_current', a.is_current, 'as_of_date', a.as_of_date) ORDER BY a.is_current DESC, a.as_of_date DESC)
                     FROM person_affiliation a WHERE a.person_id = p.id), '[]') AS affiliations
    FROM person p WHERE p.slug = ${slug} AND p.merged_into_person_id IS NULL`;
  return row ?? null;
});

export type CareerSeat = Membership & {
  company_slug: string;
  company_name: string;
  symbol: string | null;
  ipo_date: string | null;
};

export const getCareer = cache(async (personId: number): Promise<CareerSeat[]> => {
  return sql<CareerSeat[]>`
    SELECT ${MEMBERSHIP_COLUMNS}, c.slug AS company_slug, c.common_name AS company_name, s.symbol, c.ipo_date
    FROM board_membership m ${MEMBERSHIP_JOINS}
    JOIN company c ON c.id = m.company_id
    LEFT JOIN security s ON s.company_id = c.id AND s.is_primary
    WHERE m.person_id = ${personId} AND m.seat_type = 'director'
    ORDER BY m.status = 'current' DESC, m.start_date DESC NULLS LAST`;
});

export type EvidenceRow = {
  subject_type: string;
  subject_id: number;
  field: string;
  stance: "supports" | "contradicts" | "context";
  quote: string | null;
  quote_verified: boolean | null;
  extraction_method: string;
  doc_type: string;
  title: string | null;
  url: string | null;
  published_at: string | null;
  source_name: string;
};

export async function getEvidence(subjectType: string, ids: number[]): Promise<EvidenceRow[]> {
  if (ids.length === 0) return [];
  return sql<EvidenceRow[]>`
    SELECT el.subject_type, el.subject_id, el.field, el.stance, e.quote, e.quote_verified, e.extraction_method,
           d.doc_type, d.title, d.url, d.published_at, s.name AS source_name
    FROM evidence_link el
    JOIN evidence e ON e.id = el.evidence_id
    JOIN source_document d ON d.id = e.source_document_id
    JOIN source s ON s.id = d.source_id
    WHERE el.subject_type = ${subjectType} AND el.subject_id = ANY(${ids})
    ORDER BY d.published_at NULLS LAST, el.field`;
}

export type SearchHit = {
  kind: "company" | "person";
  slug: string;
  label: string;
  sublabel: string | null;
  score: number;
};

/** Typo-tolerant search over companies (name, ticker) and people (name, aliases). */
export async function search(q: string, limit = 8): Promise<SearchHit[]> {
  const query = q.trim().slice(0, 80);
  if (!query) return [];
  return sql.begin(async (tx) => {
    await tx`SET LOCAL pg_trgm.similarity_threshold = 0.25`;
    await tx`SET LOCAL pg_trgm.word_similarity_threshold = 0.45`;
    return tx<SearchHit[]>`
      WITH q AS (SELECT bt_normalize(${query}) AS q, upper(${query}) AS t)
      SELECT * FROM (
        SELECT 'company' AS kind, c.slug, c.common_name AS label,
               s.symbol || coalesce(' · ' || s.exchange, '') AS sublabel,
               greatest(
                 CASE WHEN upper(s.symbol) = q.t THEN 3 WHEN upper(s.symbol) LIKE q.t || '%' THEN 1.5 ELSE 0 END,
                 word_similarity(q.q, bt_normalize(c.common_name)) * 1.1,
                 word_similarity(q.q, bt_normalize(c.legal_name))) AS score
        FROM company c JOIN security s ON s.company_id = c.id AND s.is_primary, q
        WHERE upper(s.symbol) LIKE q.t || '%' OR q.q <% bt_normalize(c.common_name)
           OR q.q <% bt_normalize(c.legal_name)
        UNION ALL
        SELECT 'person', p.slug, p.full_name,
               (SELECT string_agg(c.common_name, ', ' ORDER BY m.start_date DESC NULLS LAST)
                FROM board_membership m JOIN company c ON c.id = m.company_id
                WHERE m.person_id = p.id AND m.status = 'current'),
               greatest(word_similarity(q.q, p.normalized_name),
                        coalesce((SELECT max(word_similarity(q.q, a.normalized_alias))
                                  FROM person_alias a WHERE a.person_id = p.id), 0))
        FROM person p, q
        WHERE p.merged_into_person_id IS NULL
          AND (q.q <% p.normalized_name OR p.normalized_name % q.q
               OR EXISTS (SELECT 1 FROM person_alias a WHERE a.person_id = p.id AND q.q <% a.normalized_alias))
      ) hits
      ORDER BY score DESC, label
      LIMIT ${limit}`;
  });
}

export type CompanyListItem = {
  slug: string;
  common_name: string;
  symbol: string | null;
  current_directors: number;
  former_directors: number;
};

export const listCompanies = cache(async (): Promise<CompanyListItem[]> => {
  return sql<CompanyListItem[]>`
    SELECT c.slug, c.common_name, s.symbol,
           count(*) FILTER (WHERE m.status = 'current')::int AS current_directors,
           count(*) FILTER (WHERE m.status = 'former')::int AS former_directors
    FROM company c
    LEFT JOIN security s ON s.company_id = c.id AND s.is_primary
    LEFT JOIN board_membership m ON m.company_id = c.id AND m.seat_type = 'director'
    GROUP BY c.id, s.symbol ORDER BY c.common_name`;
});

export const getDataThrough = cache(async (): Promise<string | null> => {
  const [r] = await sql<{ d: string | null }[]>`
    SELECT max(trade_date) AS d FROM price_daily
    WHERE security_id = (SELECT security_id FROM benchmark WHERE is_default)`;
  return r?.d ?? null;
});

export type RecentEvent = BoardEvent & { company_slug: string; company_name: string; symbol: string | null };

export const getRecentEvents = cache(async (limit = 8): Promise<RecentEvent[]> => {
  return sql<RecentEvent[]>`
    SELECT e.id, e.event_type, e.event_date, e.event_date_precision, e.announced_date, e.details,
           p.slug AS person_slug, p.full_name, e.confidence,
           c.slug AS company_slug, c.common_name AS company_name, s.symbol
    FROM board_event e
    JOIN company c ON c.id = e.company_id
    LEFT JOIN security s ON s.company_id = c.id AND s.is_primary
    LEFT JOIN person p ON p.id = e.person_id
    WHERE e.event_type IN ('BOARD_JOIN', 'BOARD_LEAVE') AND e.event_date_precision = 'day'
    ORDER BY e.event_date DESC LIMIT ${limit}`;
});
