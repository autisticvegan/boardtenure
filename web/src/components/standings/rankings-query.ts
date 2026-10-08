// URL model for /rankings (docs/design/rankings-ui.md §4.2): parsing, links, filtering and sorting.
// Pure functions shared by the server page and the client FilterBar. Filters and sorts only
// reorder or drop rows that SQL already ranked; nothing here assigns or renumbers a rank.

import type { RankScope, ScopedDirector, SeatRank, SeatRef } from "@/lib/queries";
import { DEFAULT_SCOPE, parseScope } from "@/lib/standings";

export type Tab = "directors" | "seats";
export type StatusFilter = "all" | "current" | "former";
export type SortKey = "score" | "years" | "seats" | "best" | "worst" | "name" | "drop";
export type SortDir = "asc" | "desc";
export const MIN_YEARS = [2, 5, 10] as const;
export type MinYears = (typeof MIN_YEARS)[number];

export type RankingsQuery = {
  tab: Tab;
  scope: RankScope;
  co: string[];
  status: StatusFilter;
  min: MinYears;
  multi: boolean;
  q: string;
  sort: SortKey;
  dir: SortDir;
};

export const SORTS: Record<Tab, SortKey[]> = {
  directors: ["score", "years", "seats", "best", "worst", "name"],
  seats: ["score", "years", "name", "drop"],
};

/** Numbers sort high-to-low first; names A-Z; drawdowns deepest first. */
export function defaultDir(sort: SortKey): SortDir {
  return sort === "name" || sort === "drop" ? "asc" : "desc";
}

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseRankingsQuery(sp: Search): RankingsQuery {
  const tab: Tab = one(sp.tab) === "seats" ? "seats" : "directors";
  const statusRaw = one(sp.status);
  const status: StatusFilter = statusRaw === "current" || statusRaw === "former" ? statusRaw : "all";
  const minRaw = Number(one(sp.min));
  const min = (MIN_YEARS as readonly number[]).includes(minRaw) ? (minRaw as MinYears) : 2;
  const sortRaw = one(sp.sort) as SortKey;
  const sort: SortKey = SORTS[tab].includes(sortRaw) ? sortRaw : "score";
  const dirRaw = one(sp.dir);
  const dir: SortDir = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : defaultDir(sort);
  const co = [...new Set(one(sp.co).toLowerCase().split(",").map((s) => s.trim()).filter(Boolean))];
  return {
    tab, scope: parseScope(sp), co, status, min, multi: one(sp.multi) === "1",
    q: one(sp.q).slice(0, 80), sort, dir,
  };
}

export function emptyQuery(tab: Tab, scope: RankScope): RankingsQuery {
  return { tab, scope, co: [], status: "all", min: 2, multi: false, q: "", sort: "score", dir: "desc" };
}

/** `/rankings?…` with defaults omitted, in a stable param order. */
export function rankingsHref(base: RankingsQuery, patch: Partial<RankingsQuery> = {}): string {
  const n = { ...base, ...patch };
  const p = new URLSearchParams();
  if (n.tab !== "directors") p.set("tab", n.tab);
  if (n.scope !== DEFAULT_SCOPE) p.set("scope", n.scope);
  if (n.co.length) p.set("co", n.co.join(","));
  if (n.status !== "all") p.set("status", n.status);
  if (n.tab === "directors" && n.min !== 2) p.set("min", String(n.min));
  if (n.tab === "directors" && n.multi) p.set("multi", "1");
  if (n.q.trim()) p.set("q", n.q.trim());
  if (n.sort !== "score") p.set("sort", n.sort);
  if (n.dir !== defaultDir(n.sort)) p.set("dir", n.dir);
  const s = p.toString().replace(/%2C/g, ",");
  return s ? `/rankings?${s}` : "/rankings";
}

/** Switching tabs keeps scope, companies, status and name; drops directors-only filters and the sort. */
export function tabHref(q: RankingsQuery, tab: Tab): string {
  return rankingsHref(q, { tab, min: 2, multi: false, sort: "score", dir: "desc" });
}

/** "Clear filters": only tab and scope survive. */
export function clearHref(q: RankingsQuery): string {
  return rankingsHref(emptyQuery(q.tab, q.scope));
}

/** Link for a sortable column head: toggles direction when already active. */
export function sortHref(q: RankingsQuery, key: SortKey): string {
  const dir = q.sort === key ? (q.dir === "asc" ? "desc" : "asc") : defaultDir(key);
  return rankingsHref(q, { sort: key, dir });
}

/** Filters in row 2 of the FilterBar (the mobile "Filters (n)" count). */
export function rowTwoFilterCount(q: RankingsQuery): number {
  let n = 0;
  if (q.status !== "all") n++;
  if (q.tab === "directors" && q.min !== 2) n++;
  if (q.tab === "directors" && q.multi) n++;
  if (q.q.trim()) n++;
  return n;
}

export function isFiltered(q: RankingsQuery): boolean {
  return q.co.length > 0 || rowTwoFilterCount(q) > 0;
}

// ---- name matching ---------------------------------------------------------------

// Letters NFD can't decompose that Postgres unaccent still folds.
const FOLD: Record<string, string> = { ß: "ss", æ: "ae", œ: "oe", ø: "o", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i" };

/** Same semantics as SQL bt_normalize: unaccented, lower-case, non-alphanumerics collapsed to one space. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (c) => FOLD[c] ?? c)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function nameMatcher(q: string): (name: string) => boolean {
  const needle = normalizeName(q);
  return needle ? (name) => normalizeName(name).includes(needle) : () => true;
}

// ---- directors -------------------------------------------------------------------

export const scoredSeats = (d: ScopedDirector): SeatRef[] => d.companies.filter((s) => s.in_scope);

export function filterDirectors(rows: ScopedDirector[], q: RankingsQuery): ScopedDirector[] {
  const name = nameMatcher(q.q);
  const co = new Set(q.co);
  return rows.filter((d) =>
    d.scored_years >= q.min
    && (q.status === "all" || (q.status === "current") === d.has_current_scored)
    && (!q.multi || d.scored_boards >= 2)
    && (co.size === 0 || scoredSeats(d).some((s) => co.has(s.company_slug)))
    && name(d.full_name));
}

type Val = number | string | null;

/** Stable sort; ties and nulls keep SQL order (rank, then name), nulls always last. */
function sortBy<T>(rows: T[], val: (r: T) => Val, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: val(r) }))
    .sort((a, b) => {
      if (a.v == null || b.v == null) return a.v == null && b.v == null ? a.i - b.i : a.v == null ? 1 : -1;
      const c = typeof a.v === "string" ? a.v.localeCompare(b.v as string, "en", { sensitivity: "base" }) : a.v - (b.v as number);
      return c !== 0 ? sign * c : a.i - b.i;
    })
    .map((x) => x.r);
}

export function sortDirectors(rows: ScopedDirector[], sort: SortKey, dir: SortDir): ScopedDirector[] {
  const multi = (d: ScopedDirector) => d.scored_seats > 1;
  const val: Record<string, (d: ScopedDirector) => Val> = {
    score: (d) => -d.rank, // rank order, so ties stay exactly as SQL ranked them
    years: (d) => d.scored_years,
    seats: (d) => d.scored_seats * 1000 + d.beat_seats,
    // Single-seat rows show "—" here (it would repeat the score), so they sort last.
    best: (d) => (multi(d) ? d.best_seat_excess : null),
    worst: (d) => (multi(d) ? d.worst_seat_excess : null),
    name: (d) => d.full_name,
  };
  return sortBy(rows, val[sort] ?? val.score, dir);
}

// ---- seats -----------------------------------------------------------------------

export function filterSeats(rows: SeatRank[], q: RankingsQuery): SeatRank[] {
  const name = nameMatcher(q.q);
  const co = new Set(q.co);
  return rows.filter((s) =>
    (q.status === "all" || s.seat_status === q.status)
    && (co.size === 0 || co.has(s.company_slug))
    && name(s.full_name));
}

export function sortSeats(rows: SeatRank[], sort: SortKey, dir: SortDir): SeatRank[] {
  const val: Record<string, (s: SeatRank) => Val> = {
    score: (s) => -s.rank,
    years: (s) => s.calendar_days,
    name: (s) => `${s.full_name}\u0000${s.symbol ?? ""}`,
    drop: (s) => s.max_drawdown,
  };
  return sortBy(rows, val[sort] ?? val.score, dir);
}

export const SORT_LABEL: Record<SortKey, string> = {
  score: "Per yr vs S&P",
  years: "Years",
  seats: "Scored seats",
  best: "Best seat",
  worst: "Worst seat",
  name: "Name",
  drop: "Worst drop",
};
