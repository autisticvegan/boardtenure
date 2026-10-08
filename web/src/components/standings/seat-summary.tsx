// The causation-safe seat sentence (docs/design/rankings-ui.md §4.5, §9): the stock is the
// subject of every return verb; the person only holds the seat.
import { fmtDate, pct, type Precision } from "@/lib/format";
import type { Perf } from "@/lib/queries";
import { seatWindow, years } from "@/lib/standings";
import { Signed } from "./primitives";

const EPS = 0.0005;

/** "Lawrence J. Ellison" → "Lawrence"; "R. Ann Miura-Ko" → "Ann" (skips leading initials). */
export function firstName(full: string): string {
  const parts = full.split(/\s+/).filter(Boolean);
  return parts.find((p) => !/^[A-Z]\.?$/.test(p) && !/^[A-Z]\.$/.test(p)) ?? parts[0] ?? full;
}

/** "8 months", "3 weeks", "2.4 yrs". */
export function spanLength(days: number): string {
  if (days >= 365) return `${years(days)} yrs`;
  if (days >= 60) {
    const m = Math.round(days / 30.44);
    return `${m} month${m === 1 ? "" : "s"}`;
  }
  const w = Math.max(1, Math.round(days / 7));
  return `${w} week${w === 1 ? "" : "s"}`;
}

/** "Jun 1993 – present" from membership dates at the precision they're known to. */
function heldWindow(start: string | null, startP: Precision, end: string | null, endP: Precision | null, current: boolean) {
  const f = (iso: string | null, p: Precision | null) => fmtDate(iso, p === "day" ? "month" : (p ?? "unknown"));
  return `${f(start, startP)} – ${current ? "present" : f(end, endP)}`;
}

export function SeatSummary({ name, company, sym, perf, excess, current, start, end, startPrecision = "day", endPrecision = "day" }: {
  name: string; company: string; sym: string; perf: Perf | null; current: boolean;
  /** Annualized excess vs the S&P 500 (seat_ranking), null under a year. */
  excess: number | null;
  /** Membership dates: the "sat on" window when the stock listed after the join, or nothing was measured. */
  start: string | null; end: string | null;
  startPrecision?: Precision; endPrecision?: Precision | null;
}) {
  const p = perf;
  const who = <b className="font-semibold text-ink">{name}</b>;
  const board = <><b className="font-semibold text-ink">{company}</b>&rsquo;s board</>;
  const stock = <b className="font-semibold text-ink">{sym}</b>;

  if (!p) return <>Performance hasn&rsquo;t been computed for this seat yet.</>;
  if (p.status === "no_price_history") {
    return <>{who} left {board} before {stock} began trading, so there&rsquo;s no stock return to measure for this seat.</>;
  }
  if (p.status === "unknown_dates") {
    return <>We haven&rsquo;t established when {who} joined{current ? "" : " or left"} {board}, so no return is shown.</>;
  }
  if (p.status === "history_gap") {
    return <>{who} joined {board} before the earliest {stock} price history we hold, so this seat can&rsquo;t be measured yet.</>;
  }
  if (p.status === "approximate") {
    return (
      <>
        While {who} sat on {board} ({heldWindow(start, startPrecision, end, endPrecision, current)}), {stock} returned{" "}
        <b className="num font-semibold text-ink">≈ {pct(p.return_low, 0)} to {pct(p.return_high, 0)}</b>. A seat date is
        known only to the month or year, so the exact figure isn&rsquo;t known and the seat isn&rsquo;t scored.
      </>
    );
  }

  const days = p.calendar_days ?? 0;
  const length = current && days < 365 ? `${spanLength(days)} so far` : spanLength(days);
  const xs = excess;
  // Joined before the stock listed: the person sat on the board for the membership window, but the
  // stock is measured from its first trading day, so the two are stated separately.
  const fromListing = p.start_anchor_reason === "first_trade" && p.start_anchor_date;
  const head = fromListing ? (
    <>
      While {who} sat on {board} ({heldWindow(start, startPrecision, end, endPrecision, current)}), {stock} returned{" "}
      <b className="font-semibold"><Signed value={p.total_return} kind="pct" /></b> from its first trading day
      ({fmtDate(p.start_anchor_date)}; {length}) vs{" "}
      <b className="font-semibold"><Signed value={p.bench_total_return} kind="pct" /></b> for the S&amp;P 500
    </>
  ) : (
    <>
      While {who} sat on {board} ({seatWindow(p.start_anchor_date, p.end_anchor_date, current)}, {length}), {stock} returned{" "}
      <b className="font-semibold"><Signed value={p.total_return} kind="pct" /></b> vs{" "}
      <b className="font-semibold"><Signed value={p.bench_total_return} kind="pct" /></b> for the S&amp;P 500
    </>
  );
  if (p.status !== "ok" || days < 365 || xs == null) {
    return <>{head}. Per-year figures start once a seat has a full year.</>;
  }
  const verdict = Math.abs(xs) < EPS
    ? "level with it"
    : `${xs > 0 ? "ahead" : "behind"} by ${Math.abs(xs * 100).toFixed(1)}% a year`;
  return <>{head}: {verdict}.</>;
}
