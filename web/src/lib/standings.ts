// Standings helpers shared by every ranking surface. Ranks and ties come from SQL;
// nothing here assigns or renumbers a rank. Thresholds are calibrated in
// docs/design/rankings-ui.md §11 and should be re-checked when companies are added.

import { fmtDate, pct, type Precision } from "./format";
import type { RankScope, SeatRef } from "./queries";
import { officerTitle } from "./roles";

export const ROCKET = 0.25;
export const ROUGH = -0.2;
export const WHITE_KNUCKLE_MDD = -0.8;
export const SHORT_RECORD_YEARS = 5;
export const MIN_SEAT_DAYS = 365;
export const MIN_DIRECTOR_DAYS = 730;
export const MIN_DIRECTOR_YEARS = MIN_DIRECTOR_DAYS / 365;
export const TOP_PCT_MAX = 25;
export const NEW_COMPANY_DAYS = 30;

/** 0.25 -> "25%", -0.8 -> "80%": rule thresholds for hint text, so a re-tuned constant re-words its hint. */
const thresholdPct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;

// ---- scope ---------------------------------------------------------------

export const DEFAULT_SCOPE: RankScope = "independent";
export const SCOPE_LABEL: Record<RankScope, string> = { independent: "Non-exec seats", all: "All seats" };
export const SCOPE_NOTE: Record<RankScope, string> = {
  independent: "Leaves out seats held while a CEO, president or other officer. People stay in, scored on their other seats.",
  all: "Includes exec seats; some are measured from the stock's first trading day.",
};

type Search = Record<string, string | string[] | undefined>;

export function parseScope(sp: Search | undefined): RankScope {
  return sp?.scope === "all" ? "all" : DEFAULT_SCOPE;
}

/** Build an internal URL carrying the scope (omitted when it's the default). */
export function withScope(path: string, scope: RankScope, extra: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== "") params.set(k, v);
  if (scope !== DEFAULT_SCOPE) params.set("scope", scope);
  const q = params.toString();
  return q ? `${path}${path.includes("?") ? "&" : "?"}${q}` : path;
}

// ---- numbers and labels --------------------------------------------------------

/** "+12.4%/yr" / "−3.0%/yr". */
export function perYear(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${pct(x, digits)}/yr`;
}

export function rankLabel(rank: number, tie: boolean): string {
  return tie ? `T-${rank}` : `#${rank}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Screen-reader rank text: "4th place", "Tied for 4th", "Rank 137 of 137". */
export function srRank(rank: number, tie: boolean, of?: number): string {
  if (of != null && rank === of && !tie) return `Rank ${rank} of ${of}`;
  return tie ? `Tied for ${ordinal(rank)}` : `${ordinal(rank)} place`;
}

/** Sets tie where more than one row shares a rank; never changes rank. */
export function withTies<T extends { rank: number }>(rows: T[]): (T & { tie: boolean })[] {
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.rank, (counts.get(r.rank) ?? 0) + 1);
  return rows.map((r) => ({ ...r, tie: (counts.get(r.rank) ?? 0) > 1 }));
}

/** "top 3%" — only meaningful (and only shown) when <= TOP_PCT_MAX. There is never a "bottom X%". */
export function topPct(rank: number, of: number): number | null {
  if (of <= 0) return null;
  const p = Math.max(1, Math.ceil((100 * rank) / of));
  return p <= TOP_PCT_MAX ? p : null;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Symmetric bar/dot domain over the WHOLE active scope (filters never rescale bars). */
export function barDomain(values: number[]): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return 0.2;
  const m = Math.max(Math.abs(quantile(v, 0.02)), Math.abs(quantile(v, 0.98))) * 100;
  return Math.min(100, Math.max(20, Math.ceil(m / 10) * 10)) / 100;
}

// ---- tags and chips --------------------------------------------------------------

export type Tag = { key: "white-knuckle" | "rocket" | "rough"; label: string; hint: string };

type TaggableSeat = {
  annualized_excess: number | null;
  max_drawdown: number | null;
  relative_return_pp: number | null;
};

/** Seat tags in priority order White-knuckle > Rocket > Rough ride; at most `max`. */
export function tagsFor(seat: TaggableSeat, max = 2): Tag[] {
  const out: Tag[] = [];
  if (seat.max_drawdown != null && seat.max_drawdown <= WHITE_KNUCKLE_MDD && (seat.relative_return_pp ?? 0) > 0) {
    out.push({
      key: "white-knuckle",
      label: "White-knuckle seat",
      hint: `The stock fell ${thresholdPct(WHITE_KNUCKLE_MDD)} or more from a peak during this seat and still beat the S&P 500 overall.`,
    });
  }
  if (seat.annualized_excess != null && seat.annualized_excess >= ROCKET) {
    out.push({ key: "rocket", label: "Rode the rocket", hint: `The stock beat the S&P 500 by ${thresholdPct(ROCKET)} or more a year during this seat.` });
  }
  if (seat.annualized_excess != null && seat.annualized_excess <= ROUGH) {
    out.push({ key: "rough", label: "Rough ride", hint: `The stock trailed the S&P 500 by ${thresholdPct(ROUGH)} or more a year during this seat.` });
  }
  return out.slice(0, max);
}

export const CHIP_HINT = {
  short: `Under ${SHORT_RECORD_YEARS} scored years. Short windows swing further from the S&P in both directions.`,
  exec: (title: string | null) => {
    const t = officerTitle(title);
    return `Held while an employee${t ? ` (${t})` : ""}. Left out of Non-exec seats scores.`;
  },
  ipo: (date: string | null) =>
    `Joined before the stock listed. Measured from the first trading day${date ? ` (${fmtDate(date)})` : ""}, not the join date.`,
  current: "Seat is ongoing; measured through the latest daily close.",
  isNew: (date: string) => `Added ${fmtDate(date)}.`,
};

export function shortRecord(d: { scored_years: number }): boolean {
  return d.scored_years < SHORT_RECORD_YEARS;
}

export function isNewCompany(createdAt: string, asOf: string): boolean {
  const days = (Date.parse(asOf) - Date.parse(createdAt.slice(0, 10))) / 86_400_000;
  return days >= 0 && days < NEW_COMPANY_DAYS;
}

// ---- unranked reasons --------------------------------------------------------------

export const EXEC_SEAT_REASON = "Exec seat · counted under All seats";

/**
 * Why a seat isn't counted in the scope's score (null when it is). A seat measured from the first
 * trading day that is short only because the stock listed late reads "Under 1 year after listing",
 * so it never contradicts a longer membership shown beside it.
 */
export function seatReason(seat: SeatRef, scope: RankScope): string | null {
  if (seat.in_scope) return null;
  if (seat.rank_eligible && seat.executive_seat && scope === "independent") return EXEC_SEAT_REASON;
  const under = seat.start_anchor_reason === "first_trade" ? "Under 1 year after listing" : "Under 1 year";
  switch (seat.perf_status) {
    case "too_short":
      return under;
    case "approximate":
      return `≈ Dates known to the ${approxPrecision(seat)}`;
    case "unknown_dates":
      return "Dates unknown";
    case "history_gap":
      return "Price history gap";
    case "no_price_history":
      return "Before listing";
    case "ok":
      return (seat.calendar_days ?? 0) < MIN_SEAT_DAYS ? under : null;
    default:
      return null;
  }
}

function approxPrecision(seat: SeatRef): "year" | "month" {
  const p: (Precision | null)[] = [seat.start_precision, seat.end_precision];
  return p.includes("year") ? "year" : "month";
}

/**
 * Scored years for "needs 2 scored years" copy, rounded DOWN to one decimal so 1.996 reads "1.9",
 * never "2.0" beside the 2-year threshold.
 */
export function floorYears(y: number): string {
  return (Math.floor(y * 10 + 1e-9) / 10).toFixed(1);
}

/**
 * Under Non-exec seats, someone whose only scored seats are exec seats: ranked under All seats,
 * left out here. Not "unscored" and not warming up.
 */
export function onlyExecSeats(seats: SeatRef[], scope: RankScope): boolean {
  return scope === "independent" && !seats.some((s) => s.in_scope) && seats.some((s) => s.rank_eligible && s.executive_seat);
}

export const EXEC_ONLY_REASON = "Only exec seats · counted under All seats";

export function directorReason(d: { scored_years: number }, execOnly = false): string {
  if (d.scored_years > 0) return `Needs ${MIN_DIRECTOR_YEARS} scored years · has ${floorYears(d.scored_years)}`;
  return execOnly ? EXEC_ONLY_REASON : "Only unscored seats";
}

/** Warming-up chip hint (§5.2). `around` is eligibleAround()'s date, when it found one. */
export function warmingHint(scoredYears: number, around: string | null): string {
  return `Needs ${MIN_DIRECTOR_YEARS} scored years (has ${floorYears(scoredYears)}).${
    around ? ` Could be ranked around ${fmtDate(around, "month")} if the seat continues.` : ""
  }`;
}

/**
 * Earliest date the person would reach 2 scored years if their current exact seats continue,
 * stepping day by day up to 1,100 days past dataThrough. Null when nothing qualifies.
 * Under Non-exec seats an exec seat never counts, so it can't bring anyone into the ranking.
 */
export function eligibleAround(seats: SeatRef[], dataThrough: string, scope: RankScope): string | null {
  const live = seats.filter((s) =>
    s.seat_status === "current" && s.perf_status === "ok" && s.start_anchor_date &&
    !(scope === "independent" && s.executive_seat));
  if (live.length === 0) return null;
  const done = seats
    .filter((s) => s.in_scope && s.seat_status === "former")
    .reduce((a, s) => a + (s.calendar_days ?? 0), 0);
  const base = Date.parse(dataThrough);
  for (let step = 0; step <= 1100; step++) {
    const t = base + step * 86_400_000;
    const liveDays = live.reduce((a, s) => {
      const d = Math.round((t - Date.parse(s.start_anchor_date!)) / 86_400_000);
      return a + (d >= MIN_SEAT_DAYS ? d : 0);
    }, 0);
    if (done + liveDays >= MIN_DIRECTOR_DAYS) return new Date(t).toISOString().slice(0, 10);
  }
  return null;
}

/** "Jul 2010 – present" / "Mar 2019 – Aug 2025". */
export function seatWindow(start: string | null, end: string | null, current: boolean): string {
  const m = (iso: string | null) => (iso ? fmtDate(iso, "month") : "?");
  return `${m(start)} – ${current ? "present" : m(end)}`;
}

/** Measured years, floored like floorYears() so 729 days reads "1.9", never "2.0" beside a 2-year rule. */
export function years(days: number | null | undefined): string {
  return days == null ? "—" : floorYears(days / 365.25);
}
