import type { CareerSeat } from "./queries";
import { daysBetween, todayIso } from "./format";

export type TrackRecord = {
  seats: number;
  current: number;
  completed: number;
  measured: number; // tenures with an exact return (status ok)
  approximate: number; // tenures with only a return range
  unmeasured: number; // pre-listing, too short, or unknown dates
  median_return: number | null;
  mean_return: number | null;
  median_annualized: number | null; // tenures of at least one year only
  mean_annualized: number | null;
  annualized_n: number;
  median_relative_pp: number | null;
  mean_relative_pp: number | null;
  positive: number;
  negative: number;
  outperformed: number;
  relative_n: number;
  company_years: number;
  best: { company: string; slug: string; total_return: number } | null;
  worst: { company: string; slug: string; total_return: number } | null;
};

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Aggregate a director's tenures; rules in docs/methodology.md ("Aggregates"). */
export function trackRecord(seats: CareerSeat[]): TrackRecord {
  const ok = seats.filter((s) => s.perf?.status === "ok" && s.perf.total_return != null);
  const returns = ok.map((s) => s.perf!.total_return!);
  const annual = ok.map((s) => s.perf!.annualized_return).filter((x): x is number => x != null);
  const rel = ok.map((s) => s.perf!.relative_return_pp).filter((x): x is number => x != null);
  const byReturn = [...ok].sort((a, b) => a.perf!.total_return! - b.perf!.total_return!);
  const pick = (s: CareerSeat | undefined) =>
    s ? { company: s.company_name, slug: s.company_slug, total_return: s.perf!.total_return! } : null;
  const companyDays = seats.reduce((acc, s) => {
    if (!s.start_date || s.start_precision === "unknown") return acc;
    return acc + Math.max(0, daysBetween(s.start_date, s.end_date ?? todayIso()));
  }, 0);
  return {
    seats: seats.length,
    current: seats.filter((s) => s.status === "current").length,
    completed: seats.filter((s) => s.status === "former").length,
    measured: ok.length,
    approximate: seats.filter((s) => s.perf?.status === "approximate").length,
    unmeasured: seats.filter((s) => !s.perf || !["ok", "approximate"].includes(s.perf.status)).length,
    median_return: median(returns),
    mean_return: mean(returns),
    median_annualized: median(annual),
    mean_annualized: mean(annual),
    annualized_n: annual.length,
    median_relative_pp: median(rel),
    mean_relative_pp: mean(rel),
    positive: returns.filter((r) => r > 0).length,
    negative: returns.filter((r) => r < 0).length,
    outperformed: rel.filter((r) => r > 0).length,
    relative_n: rel.length,
    company_years: companyDays / 365.25,
    best: ok.length > 1 ? pick(byReturn.at(-1)) : null,
    worst: ok.length > 1 ? pick(byReturn[0]) : null,
  };
}
