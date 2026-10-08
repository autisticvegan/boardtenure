// Records (§4.1 section 6, §5.2 RecordTile). Seat-level, scope-aware, rank-eligible seats only.
// A seat used by an earlier tile is skipped; ties show the first by name plus "tied with n other seat(s)".
import Link from "next/link";
import type { ReactNode } from "react";
import { fmtDate, pct } from "@/lib/format";
import type { RankScope, RecordSeat, Records } from "@/lib/queries";
import { withScope, years } from "@/lib/standings";
import { SectionHead, Signed } from "./primitives";

export function RecordTile({ kicker, title, value, valueLabel, detail, href }: {
  kicker: string; title: ReactNode; value: ReactNode; valueLabel?: string; detail: ReactNode; href: string;
}) {
  return (
    <Link
      href={href}
      className="block h-full rounded-[14px] border border-line bg-surface shadow-card p-4 md:p-5 transition duration-[120ms]
                 hover:-translate-y-0.5 hover:border-line-strong focus-visible:-translate-y-0.5 focus-visible:border-line-strong"
    >
      <p className="text-[11px] leading-[14px] font-semibold uppercase tracking-[0.08em] text-ink-3">{kicker}</p>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
        <span className="text-[32px] leading-9 font-extrabold tracking-[-0.02em] text-ink">{value}</span>
        {valueLabel && <span className="text-[12px] leading-4 text-ink-3">{valueLabel}</span>}
      </p>
      <p className="mt-2 text-[15px] leading-5 font-[650] text-ink">{title}</p>
      <p className="mt-1 text-[13px] leading-5 text-ink-2">{detail}</p>
    </Link>
  );
}

const sym = (s: { symbol: string | null; company_slug: string }) => s.symbol ?? s.company_slug.toUpperCase();
const seatHref = (s: RecordSeat, scope: RankScope) => withScope(`/c/${s.company_slug}/d/${s.person_slug}`, scope);
const tied = (n: number, one: string, many: string) => (n > 1 ? ` · tied with ${n - 1} other ${n - 1 === 1 ? one : many}` : "");

/** "Jan 3 → Oct 9, 2002" within one year, otherwise "Dec 10, 1999 → Sep 28, 2001". */
export function dropRange(peak: string | null, trough: string | null): string | null {
  if (!peak || !trough) return null;
  const a = fmtDate(peak);
  const b = fmtDate(trough);
  return peak.slice(0, 4) === trough.slice(0, 4) ? `${a.replace(/, \d{4}$/, "")} → ${b}` : `${a} → ${b}`;
}

export function RecordsSection({ records, scope }: { records: Records; scope: RankScope }) {
  const used = new Set<number>();
  const take = (list: RecordSeat[]) => {
    const s = list.find((x) => !used.has(x.membership_id)) ?? null;
    if (s) used.add(s.membership_id);
    return s;
  };
  const tiles: ReactNode[] = [];

  const longest = take(records.longest);
  if (longest) {
    tiles.push(
      <RecordTile key="longest" kicker="Longest scored seat" href={seatHref(longest, scope)}
        value={`${years(longest.calendar_days)} yrs`}
        title={longest.full_name}
        detail={<>{sym(longest)} · <Signed value={longest.annualized_excess} kind="perYear" /> vs S&amp;P over the seat{tied(longest.tie_count, "seat", "seats")}</>}
      />,
    );
  }

  const wk = take(records.whiteKnuckle);
  if (wk && wk.max_drawdown != null) {
    const range = dropRange(wk.mdd_peak_date, wk.mdd_trough_date);
    tiles.push(
      <RecordTile key="white-knuckle" kicker="White-knuckle seat" href={seatHref(wk, scope)}
        value={<Signed value={wk.max_drawdown} kind="pct" glyph size="m" />}
        valueLabel="worst drop"
        title={wk.full_name}
        detail={<>{sym(wk)}{range && <>, {range}</>}, and still beat the S&amp;P by {pct(wk.annualized_excess, 1, false)}/yr{tied(wk.tie_count, "seat", "seats")}</>}
      />,
    );
  }

  const lag = take(records.steepestLag);
  if (lag) {
    tiles.push(
      <RecordTile key="lag" kicker="Steepest lag, 5+ years" href={seatHref(lag, scope)}
        value={<Signed value={lag.annualized_excess} kind="perYear" glyph size="m" />}
        title={lag.full_name}
        detail={<>{sym(lag)} · {years(lag.calendar_days)} yrs{tied(lag.tie_count, "seat", "seats")}</>}
      />,
    );
  }

  const spread = records.widestSpread[0];
  if (spread && spread.seats.length >= 2) {
    const best = spread.seats[0];
    const worst = spread.seats[spread.seats.length - 1];
    tiles.push(
      <RecordTile key="spread" kicker="Widest spread across boards" href={withScope(`/d/${spread.person_slug}`, scope)}
        value={`${(spread.spread * 100).toFixed(1)} pts/yr`}
        title={spread.full_name}
        detail={<>
          {sym(best)} <Signed value={best.annualized_excess} kind="perYear" /> · {sym(worst)} <Signed value={worst.annualized_excess} kind="perYear" />
          {tied(spread.tie_count, "person", "people")}
        </>}
      />,
    );
  }

  if (tiles.length < 2) return null;
  return (
    <section aria-labelledby="records">
      <SectionHead id="records" title="Records" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{tiles}</div>
    </section>
  );
}
