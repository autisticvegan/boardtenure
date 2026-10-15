import "server-only";
import { cache } from "react";
import { sql } from "./db";
import type { Precision } from "./format";
import { normalizeAndAlign, type ChartPoint } from "./series";

export type Perf = {
  status: "ok" | "approximate" | "too_short" | "no_price_history" | "unknown_dates" | "history_gap";
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
  shares: number | null;
  shares_as_of: string | null;
  share_classes: number;
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
  -- A current seat counts only an open determination (a current executive seat is never independent);
  -- a former seat takes its last one. Otherwise unknown.
  LEFT JOIN LATERAL (
    SELECT coalesce(
      (SELECT bi.is_independent FROM board_independence bi WHERE bi.membership_id = m.id
         AND (m.status = 'former' OR bi.end_date IS NULL)
       ORDER BY (bi.end_date IS NULL) DESC, bi.end_date DESC NULLS LAST LIMIT 1),
      CASE WHEN EXISTS (SELECT 1 FROM board_role r WHERE r.membership_id = m.id AND r.role = 'executive_director'
                          AND (r.is_current OR m.status = 'former')) THEN false END) AS is_independent) ind ON true
  LEFT JOIN tenure_performance tp
    ON tp.membership_id = m.id AND tp.benchmark_id = (SELECT id FROM benchmark WHERE is_default)`;

export const getCompany = cache(async (slug: string): Promise<CompanyHeader | null> => {
  const [row] = await sql<CompanyHeader[]>`
    SELECT c.id, c.slug, c.cik, c.legal_name, c.common_name, c.status, c.ipo_date, c.sector, c.industry,
           c.website, s.id AS security_id, s.symbol, s.exchange,
           lp.close AS last_close, lp.trade_date AS last_date, pp.close AS prev_close,
           so.shares, so.as_of_date AS shares_as_of, coalesce(jsonb_array_length(so.class_breakdown), 0) AS share_classes
    FROM company c
    LEFT JOIN security s ON s.company_id = c.id AND s.is_primary
    LEFT JOIN LATERAL (SELECT close, trade_date FROM price_daily WHERE security_id = s.id
                       ORDER BY trade_date DESC LIMIT 1) lp ON true
    LEFT JOIN LATERAL (SELECT close FROM price_daily WHERE security_id = s.id AND trade_date < lp.trade_date
                       ORDER BY trade_date DESC LIMIT 1) pp ON true
    LEFT JOIN LATERAL (SELECT shares, as_of_date, class_breakdown FROM shares_outstanding
                       WHERE company_id = c.id ORDER BY as_of_date DESC LIMIT 1) so ON true
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
  cik: string | null;
  common_name: string;
  symbol: string | null;
  current_directors: number;
  former_directors: number;
};

export const listCompanies = cache(async (): Promise<CompanyListItem[]> => {
  return sql<CompanyListItem[]>`
    SELECT c.slug, c.cik, c.common_name, s.symbol,
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

export type OtherBoard = { company: string; status: string; years: string | null; tracked_slug: string | null; source_company: string };

/** Other public boards named in proxy bios: staged facts, shown as unverified context. */
export const getOtherBoards = cache(async (personId: number): Promise<OtherBoard[]> => {
  return sql<OtherBoard[]>`
    SELECT DISTINCT ON (lower(x.payload->>'company'))
           x.payload->>'company' AS company, x.payload->>'status' AS status, x.payload->>'years' AS years,
           tc.slug AS tracked_slug, src.common_name AS source_company
    FROM extracted_fact x
    JOIN company src ON src.id = x.company_id
    LEFT JOIN LATERAL (
      SELECT c.slug FROM company c
      WHERE word_similarity(bt_normalize(c.common_name), bt_normalize(x.payload->>'company')) > 0.9
        AND EXISTS (SELECT 1 FROM board_membership m WHERE m.company_id = c.id AND m.person_id = x.resolved_person_id)
      LIMIT 1) tc ON true
    WHERE x.fact_type = 'other_board_disclosed' AND x.resolved_person_id = ${personId} AND x.status <> 'rejected'
    ORDER BY lower(x.payload->>'company'), x.created_at DESC`;
});

// ---------------------------------------------------------------------------
// Rankings. Eligibility and scores live in the SQL views (seat_ranking, director_scorecard);
// ranks always come from SQL rank(), never from TypeScript. See docs/design/rankings-ui.md.
// ---------------------------------------------------------------------------

/** "independent" is the internal name of the UI's "Non-exec seats" scope. */
export type RankScope = "all" | "independent";

export type SeatRef = {
  membership_id: number;
  company_slug: string;
  company_name: string;
  symbol: string | null;
  seat_status: "current" | "former";
  perf_status: Perf["status"];
  executive_seat: boolean;
  executive_title: string | null;
  rank_eligible: boolean; // scored (>= 1 year, exact) — independent of scope
  in_scope: boolean; // counts toward the active scope's score
  annualized_excess: number | null;
  total_return: number | null;
  bench_total_return: number | null;
  relative_return_pp: number | null;
  calendar_days: number | null;
  max_drawdown: number | null;
  mdd_peak_date: string | null;
  mdd_trough_date: string | null;
  start_anchor_reason: string | null;
  start_anchor_date: string | null;
  end_anchor_date: string | null;
  start_date: string | null;
  start_precision: Precision;
  end_date: string | null;
  end_precision: Precision | null;
  return_low: number | null;
  return_high: number | null;
};

// JSON for one seat_ranking row `sr` joined to company `c` and security `sec`.
const seatRefJson = (scope: RankScope) => sql`json_build_object(
  'membership_id', sr.membership_id, 'company_slug', c.slug, 'company_name', c.common_name, 'symbol', sec.symbol,
  'seat_status', sr.seat_status, 'perf_status', sr.status, 'executive_seat', sr.executive_seat,
  'executive_title', sr.executive_title, 'rank_eligible', sr.rank_eligible,
  'in_scope', sr.rank_eligible ${scope === "independent" ? sql`AND NOT sr.executive_seat` : sql``},
  'annualized_excess', sr.annualized_excess, 'total_return', sr.total_return,
  'bench_total_return', sr.bench_total_return, 'relative_return_pp', sr.relative_return_pp,
  'calendar_days', sr.calendar_days, 'max_drawdown', sr.max_drawdown, 'mdd_peak_date', sr.mdd_peak_date,
  'mdd_trough_date', sr.mdd_trough_date, 'start_anchor_reason', sr.start_anchor_reason,
  'start_anchor_date', sr.start_anchor_date, 'end_anchor_date', sr.end_anchor_date,
  'start_date', sr.start_date, 'start_precision', sr.start_precision, 'end_date', sr.end_date,
  'end_precision', sr.end_precision, 'return_low', sr.return_low, 'return_high', sr.return_high)`;

const inScope = (scope: RankScope) =>
  scope === "independent" ? sql`sr.rank_eligible AND NOT sr.executive_seat` : sql`sr.rank_eligible`;

export type ScopedDirector = {
  person_id: number;
  slug: string;
  full_name: string;
  rank: number;
  of: number;
  tie: boolean;
  score: number;
  scored_seats: number;
  scored_years: number;
  beat_seats: number;
  scored_boards: number;
  best_seat_excess: number | null;
  worst_seat_excess: number | null;
  seats: number;
  current_seats: number;
  has_current_scored: boolean;
  scored_executive_seat: boolean;
  companies: SeatRef[]; // every seat, best scored first; `in_scope` marks the ones in this score
};
/** @deprecated use ScopedDirector */
export type DirectorRank = ScopedDirector;

/** All rank-eligible directors for a scope, best first, ranks and ties from SQL. */
export const getDirectorRankings = cache(async (scope: RankScope): Promise<ScopedDirector[]> => {
  const ind = scope === "independent";
  const col = (name: string) => sql.unsafe(ind ? `d.independent_${name}` : `d.${name}`);
  return sql<ScopedDirector[]>`
    WITH ranked AS (
      SELECT d.person_id, d.slug, d.full_name, d.seats, d.current_seats, d.scored_executive_seat,
             ${col("score")} AS score, ${col("scored_seats")} AS scored_seats, ${col("scored_years")} AS scored_years,
             ${col("beat_seats")} AS beat_seats, ${col("scored_boards")} AS scored_boards,
             ${col("best_seat_excess")} AS best_seat_excess, ${col("worst_seat_excess")} AS worst_seat_excess
      FROM director_scorecard d
      WHERE ${ind ? sql`d.independent_rank_eligible` : sql`d.rank_eligible`}),
    numbered AS (
      SELECT r.*, (rank() OVER (ORDER BY r.score DESC))::int AS rank, (count(*) OVER ())::int AS of FROM ranked r)
    SELECT n.*, (count(*) OVER (PARTITION BY n.rank) > 1) AS tie,
           EXISTS (SELECT 1 FROM seat_ranking sr WHERE sr.person_id = n.person_id AND sr.seat_status = 'current'
                     AND ${inScope(scope)}) AS has_current_scored,
           (SELECT json_agg(${seatRefJson(scope)} ORDER BY (${inScope(scope)}) DESC, sr.annualized_excess DESC NULLS LAST)
            FROM seat_ranking sr JOIN company c ON c.id = sr.company_id
            LEFT JOIN security sec ON sec.company_id = c.id AND sec.is_primary
            WHERE sr.person_id = n.person_id) AS companies
    FROM numbered n
    ORDER BY n.rank, n.full_name`;
});

export type SeatRank = {
  membership_id: number;
  rank: number;
  of: number;
  tie: boolean;
  person_slug: string;
  full_name: string;
  company_slug: string;
  company_name: string;
  symbol: string | null;
  seat_status: "current" | "former";
  executive_seat: boolean;
  executive_title: string | null;
  start_anchor_date: string;
  start_anchor_reason: string;
  end_anchor_date: string;
  calendar_days: number;
  total_return: number;
  bench_total_return: number;
  relative_return_pp: number;
  annualized_excess: number;
  max_drawdown: number | null;
  mdd_peak_date: string | null;
  mdd_trough_date: string | null;
  start_date: string | null;
  start_precision: Precision;
};

/** Scored seats in a scope, best first. */
export const getSeatRankings = cache(async (scope: RankScope): Promise<SeatRank[]> => {
  return sql<SeatRank[]>`
    WITH numbered AS (
      SELECT sr.*, (rank() OVER (ORDER BY sr.annualized_excess DESC))::int AS rank, (count(*) OVER ())::int AS of
      FROM seat_ranking sr WHERE ${inScope(scope)})
    SELECT sr.membership_id, sr.rank, sr.of, (count(*) OVER (PARTITION BY sr.rank) > 1) AS tie,
           p.slug AS person_slug, p.full_name, c.slug AS company_slug, c.common_name AS company_name,
           sec.symbol, sr.seat_status, sr.executive_seat, sr.executive_title, sr.start_anchor_date,
           sr.start_anchor_reason, sr.end_anchor_date, sr.calendar_days, sr.total_return, sr.bench_total_return,
           sr.relative_return_pp, sr.annualized_excess, sr.max_drawdown, sr.mdd_peak_date, sr.mdd_trough_date,
           sr.start_date, sr.start_precision
    FROM numbered sr
    JOIN person p ON p.id = sr.person_id
    JOIN company c ON c.id = sr.company_id
    LEFT JOIN security sec ON sec.company_id = c.id AND sec.is_primary
    ORDER BY sr.rank, p.full_name`;
});

export type LeaderboardStats = {
  companies: number;
  ranked_directors: number;
  scored_seats: number;
  beat_seats: number;
  directors_beating: number;
  median_score: number | null;
  median_seat_excess: number | null;
  single_seat_ranked: number;
  multi_board_people: number;
  unranked_people: number;
  people: number;
  seats: number;
  data_through: string | null;
};

export const getLeaderboardStats = cache(async (scope: RankScope): Promise<LeaderboardStats> => {
  const ind = scope === "independent";
  const eligible = ind ? sql`d.independent_rank_eligible` : sql`d.rank_eligible`;
  const score = ind ? sql`d.independent_score` : sql`d.score`;
  const seatsCol = ind ? sql`d.independent_scored_seats` : sql`d.scored_seats`;
  const [r] = await sql<LeaderboardStats[]>`
    SELECT (SELECT count(*) FROM company)::int AS companies,
           (SELECT count(*) FROM director_scorecard d WHERE ${eligible})::int AS ranked_directors,
           (SELECT count(*) FROM seat_ranking sr WHERE ${inScope(scope)})::int AS scored_seats,
           (SELECT count(*) FROM seat_ranking sr WHERE ${inScope(scope)} AND sr.relative_return_pp > 0)::int AS beat_seats,
           (SELECT count(*) FROM director_scorecard d WHERE ${eligible} AND ${score} > 0)::int AS directors_beating,
           (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ${score}) FROM director_scorecard d WHERE ${eligible})
             AS median_score,
           (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY sr.annualized_excess) FROM seat_ranking sr
             WHERE ${inScope(scope)}) AS median_seat_excess,
           (SELECT count(*) FROM director_scorecard d WHERE ${eligible} AND ${seatsCol} = 1)::int AS single_seat_ranked,
           (SELECT count(*) FROM (SELECT sr.person_id FROM seat_ranking sr WHERE ${inScope(scope)}
                                  GROUP BY sr.person_id HAVING count(DISTINCT sr.company_id) >= 2) x)::int AS multi_board_people,
           (SELECT count(*) FROM director_scorecard d WHERE NOT ${eligible})::int AS unranked_people,
           (SELECT count(*) FROM director_scorecard)::int AS people,
           (SELECT count(*) FROM seat_ranking)::int AS seats,
           (SELECT max(data_through) FROM seat_ranking) AS data_through`;
  return r;
});

export type UnrankedPerson = { slug: string; full_name: string; scored_years: number; scored_seats: number; seats: SeatRef[] };

/** People who are not rank-eligible in the scope, with every seat (reasons are derived in standings.ts). */
export const getUnranked = cache(async (scope: RankScope): Promise<UnrankedPerson[]> => {
  const ind = scope === "independent";
  return sql<UnrankedPerson[]>`
    SELECT d.slug, d.full_name,
           ${ind ? sql`d.independent_scored_years` : sql`d.scored_years`} AS scored_years,
           ${ind ? sql`d.independent_scored_seats` : sql`d.scored_seats`} AS scored_seats,
           (SELECT json_agg(${seatRefJson(scope)} ORDER BY sr.start_anchor_date NULLS LAST)
            FROM seat_ranking sr JOIN company c ON c.id = sr.company_id
            LEFT JOIN security sec ON sec.company_id = c.id AND sec.is_primary
            WHERE sr.person_id = d.person_id) AS seats
    FROM director_scorecard d
    WHERE NOT ${ind ? sql`d.independent_rank_eligible` : sql`d.rank_eligible`}
    ORDER BY scored_years DESC, d.full_name`;
});

export type StripSeat = {
  membership_id: number;
  person_slug: string;
  full_name: string;
  annualized_excess: number;
  executive_seat: boolean;
  start_anchor_date: string;
  end_anchor_date: string;
  seat_status: "current" | "former";
  total_return: number;
  bench_total_return: number;
};
export type BoardStripRow = {
  slug: string;
  symbol: string | null;
  common_name: string;
  created_at: string;
  scored: number;
  beat: number;
  median_excess: number | null;
  seats: StripSeat[];
};

/** One row per company: its scored seats in the scope, sorted by median seat (desc, empty boards last). */
export const getBoardStrips = cache(async (scope: RankScope): Promise<BoardStripRow[]> => {
  return sql<BoardStripRow[]>`
    SELECT c.slug, sec.symbol, c.common_name, c.created_at::text,
           count(sr.membership_id)::int AS scored,
           count(*) FILTER (WHERE sr.relative_return_pp > 0)::int AS beat,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY sr.annualized_excess) AS median_excess,
           coalesce(json_agg(json_build_object(
             'membership_id', sr.membership_id, 'person_slug', p.slug, 'full_name', p.full_name,
             'annualized_excess', sr.annualized_excess, 'executive_seat', sr.executive_seat,
             'start_anchor_date', sr.start_anchor_date, 'end_anchor_date', sr.end_anchor_date,
             'seat_status', sr.seat_status, 'total_return', sr.total_return,
             'bench_total_return', sr.bench_total_return) ORDER BY sr.annualized_excess)
             FILTER (WHERE sr.membership_id IS NOT NULL), '[]') AS seats
    FROM company c
    LEFT JOIN security sec ON sec.company_id = c.id AND sec.is_primary
    LEFT JOIN seat_ranking sr ON sr.company_id = c.id AND ${inScope(scope)}
    LEFT JOIN person p ON p.id = sr.person_id
    GROUP BY c.id, sec.symbol
    ORDER BY count(sr.membership_id) = 0, median_excess DESC NULLS LAST, c.common_name`;
});

export type RecordSeat = {
  membership_id: number;
  person_slug: string;
  full_name: string;
  company_slug: string;
  symbol: string | null;
  calendar_days: number;
  annualized_excess: number;
  max_drawdown: number | null;
  mdd_peak_date: string | null;
  mdd_trough_date: string | null;
  tie_count: number; // seats sharing this record value (1 = no tie)
};
export type SpreadRecord = {
  person_slug: string;
  full_name: string;
  spread: number;
  tie_count: number;
  seats: { symbol: string | null; company_slug: string; annualized_excess: number }[];
};
export type Records = { longest: RecordSeat[]; whiteKnuckle: RecordSeat[]; steepestLag: RecordSeat[]; widestSpread: SpreadRecord[] };

/** The dashboard's record tiles: top 3 candidates each, so the page can de-duplicate and show ties. */
export const getRecords = cache(async (scope: RankScope): Promise<Records> => {
  // `value` is the record's own column (referencing alias sr), used to count ties.
  const base = (orderAndFilter: ReturnType<typeof sql>, value: string) => sql<RecordSeat[]>`
    WITH s AS (
      SELECT sr.*, (count(*) OVER (PARTITION BY ${sql.unsafe(value)}))::int AS tie_count
      FROM seat_ranking sr WHERE ${inScope(scope)})
    SELECT s.membership_id, p.slug AS person_slug, p.full_name, c.slug AS company_slug, sec.symbol, s.calendar_days,
           s.annualized_excess, s.max_drawdown, s.mdd_peak_date, s.mdd_trough_date, s.tie_count
    FROM s JOIN person p ON p.id = s.person_id JOIN company c ON c.id = s.company_id
    LEFT JOIN security sec ON sec.company_id = c.id AND sec.is_primary
    ${orderAndFilter} LIMIT 3`;
  const [longest, whiteKnuckle, steepestLag, widestSpread] = await Promise.all([
    base(sql`ORDER BY s.calendar_days DESC, p.full_name`, "sr.calendar_days"),
    base(sql`WHERE s.relative_return_pp > 0 AND s.max_drawdown IS NOT NULL ORDER BY s.max_drawdown ASC, p.full_name`,
      "round(sr.max_drawdown::numeric, 6), (sr.relative_return_pp > 0)"),
    base(sql`WHERE s.calendar_days >= 1826 ORDER BY s.annualized_excess ASC, p.full_name`,
      "round(sr.annualized_excess::numeric, 9), (sr.calendar_days >= 1826)"),
    sql<SpreadRecord[]>`
      WITH per AS (
        SELECT sr.person_id, max(sr.annualized_excess) - min(sr.annualized_excess) AS spread,
               count(DISTINCT sr.company_id) AS boards
        FROM seat_ranking sr WHERE ${inScope(scope)} GROUP BY sr.person_id HAVING count(DISTINCT sr.company_id) >= 2),
      tied AS (SELECT per.*, (count(*) OVER (PARTITION BY round(per.spread::numeric, 9)))::int AS tie_count FROM per)
      SELECT p.slug AS person_slug, p.full_name, t.spread, t.tie_count,
             (SELECT json_agg(json_build_object('symbol', sec.symbol, 'company_slug', c.slug,
                       'annualized_excess', sr.annualized_excess) ORDER BY sr.annualized_excess DESC)
              FROM seat_ranking sr JOIN company c ON c.id = sr.company_id
              LEFT JOIN security sec ON sec.company_id = c.id AND sec.is_primary
              WHERE sr.person_id = t.person_id AND ${inScope(scope)}) AS seats
      FROM tied t JOIN person p ON p.id = t.person_id
      ORDER BY t.spread DESC, p.full_name LIMIT 3`,
  ]);
  return { longest, whiteKnuckle, steepestLag, widestSpread };
});

export type MultiBoardPerson = {
  slug: string;
  full_name: string;
  boards: number;
  spread: number | null; // best - worst in-scope seat excess
  seats: SeatRef[];
};

/**
 * People with scored seats on 2+ distinct tracked companies in the scope (P0-2). `boards` counts
 * those companies; `seats` is every seat, with `in_scope` marking the ones that count.
 */
export const getMultiBoard = cache(async (scope: RankScope): Promise<MultiBoardPerson[]> => {
  return sql<MultiBoardPerson[]>`
    WITH multi AS (
      SELECT sr.person_id, count(DISTINCT sr.company_id)::int AS boards,
             max(sr.annualized_excess) - min(sr.annualized_excess) AS spread
      FROM seat_ranking sr WHERE ${inScope(scope)}
      GROUP BY sr.person_id HAVING count(DISTINCT sr.company_id) >= 2)
    SELECT p.slug, p.full_name, m.boards, m.spread,
           (SELECT json_agg(${seatRefJson(scope)} ORDER BY sr.annualized_excess DESC NULLS LAST)
            FROM seat_ranking sr JOIN company c ON c.id = sr.company_id
            LEFT JOIN security sec ON sec.company_id = c.id AND sec.is_primary
            WHERE sr.person_id = m.person_id) AS seats
    FROM multi m JOIN person p ON p.id = m.person_id
    ORDER BY m.spread DESC NULLS LAST, m.boards DESC, p.full_name`;
});

/** One director's standing in both scopes (null when not ranked there). */
export const getDirectorRank = cache(async (personId: number) => {
  const [all, independent] = await Promise.all([getDirectorRankings("all"), getDirectorRankings("independent")]);
  return {
    all: all.find((d) => d.person_id === personId) ?? null,
    independent: independent.find((d) => d.person_id === personId) ?? null,
  };
});

export type CompanySeat = SeatRef & {
  person_slug: string;
  full_name: string;
  global_rank: number | null; // seat rank among all scored seats in the scope
  of: number;
  tie: boolean;
};

/** A company's seats for its Board standings: scope-scored seats first (best first), then the rest. */
export const getCompanyLeaderboard = cache(async (companyId: number, scope: RankScope): Promise<CompanySeat[]> => {
  return sql<CompanySeat[]>`
    WITH ranked AS (
      SELECT sr.membership_id, (rank() OVER (ORDER BY sr.annualized_excess DESC))::int AS global_rank,
             (count(*) OVER ())::int AS of
      FROM seat_ranking sr WHERE ${inScope(scope)}),
    tied AS (SELECT r.*, (count(*) OVER (PARTITION BY r.global_rank) > 1) AS tie FROM ranked r)
    SELECT (${seatRefJson(scope)})::jsonb || jsonb_build_object(
             'person_slug', p.slug, 'full_name', p.full_name, 'global_rank', t.global_rank,
             'of', coalesce(t.of, (SELECT count(*) FROM ranked)), 'tie', coalesce(t.tie, false)) AS row
    FROM seat_ranking sr
    JOIN person p ON p.id = sr.person_id
    JOIN company c ON c.id = sr.company_id
    LEFT JOIN security sec ON sec.company_id = c.id AND sec.is_primary
    LEFT JOIN tied t ON t.membership_id = sr.membership_id
    WHERE sr.company_id = ${companyId}
    ORDER BY (t.global_rank IS NULL), sr.annualized_excess DESC NULLS LAST, p.full_name`
    .then((rows) => rows.map((r) => (r as unknown as { row: CompanySeat }).row));
});

/** A seat's standing in a scope (null if not scored there). */
export const getSeatRank = cache(async (membershipId: number, scope: RankScope) => {
  return (await getSeatRankings(scope)).find((s) => s.membership_id === membershipId) ?? null;
});
