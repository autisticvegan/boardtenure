// UnrankedList (docs/design/rankings-ui.md §5.3, §5.4): who isn't ranked (Directors tab) or which
// seats aren't scored (Seats tab), grouped by reason. Collapsed by default; hidden when empty.
import Link from "next/link";
import type { ReactNode } from "react";
import { fmtDate, pct, type Precision } from "@/lib/format";
import type { RankScope, SeatRef, UnrankedPerson } from "@/lib/queries";
import {
  directorReason, eligibleAround, EXEC_SEAT_REASON, floorYears, MIN_DIRECTOR_YEARS, onlyExecSeats,
  seatReason, warmingHint, withScope,
} from "@/lib/standings";
import { Chip } from "./primitives";

export type UnscoredSeat = SeatRef & { person_slug: string; full_name: string };

function Disclosure({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-line bg-surface">
      <summary className="flex items-center justify-between gap-3 cursor-pointer select-none list-none px-4 sm:px-5 min-h-11 text-[13px] font-semibold text-ink hover:text-accent-ink [&::-webkit-details-marker]:hidden">
        <span className="num">{title}</span>
        <span aria-hidden className="text-ink-3 transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="px-4 sm:px-5 pb-5 space-y-6">{children}</div>
    </details>
  );
}

// h2: these lists sit directly under the /rankings h1.
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[11px] leading-[14px] uppercase font-semibold tracking-[0.08em] text-ink-3 num">{title}</h2>
      <ul className="mt-1 divide-y divide-line">{children}</ul>
    </section>
  );
}

const countLabel = (shown: number, total: number) => (shown === total ? `${total}` : `${shown} of ${total}`);

/** "≈ Dates known to the year" seats carry the measured range ("+40% to +65%"). */
function Range({ seat }: { seat: SeatRef }) {
  if (seat.perf_status !== "approximate" || seat.return_low == null || seat.return_high == null) return null;
  return <span className="num text-[12px] leading-4 text-ink-2">{pct(seat.return_low, 0)} to {pct(seat.return_high, 0)}</span>;
}

function seatChipLabel(seat: SeatRef, scope: RankScope): string {
  const sym = seat.symbol ?? seat.company_name;
  const reason = seatReason(seat, scope);
  // Floor, not round: a 1.996-year seat must not read "2.0" next to "needs 2 scored years".
  const yrs = seat.calendar_days == null ? "—" : floorYears(seat.calendar_days / 365.25);
  return reason ? `${sym} · ${reason}` : `${sym} · ${yrs} scored yrs`;
}

// ---- Directors tab ----------------------------------------------------------------------

export function UnrankedList({ people, total, scope, dataThrough }: {
  people: UnrankedPerson[]; total: number; scope: RankScope; dataThrough: string | null;
}) {
  if (people.length === 0) return null;
  // Group order (§5.3): warming up, then exec-only (Non-exec seats: ranked under All seats), then unscored.
  const execOnly = new Set(people.filter((p) => !(p.scored_years > 0) && onlyExecSeats(p.seats, scope)).map((p) => p.slug));
  const warming = people.filter((p) => p.scored_years > 0);
  const exec = people.filter((p) => execOnly.has(p.slug));
  const unscored = people.filter((p) => !(p.scored_years > 0) && !execOnly.has(p.slug));

  const row = (p: UnrankedPerson) => {
    const around = dataThrough ? eligibleAround(p.seats, dataThrough, scope) : null;
    return (
      <li key={p.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
        <Link href={withScope(`/d/${p.slug}`, scope)} className="min-h-6 max-md:min-h-11 inline-flex items-center font-semibold text-[14px] leading-5 text-ink hover:text-accent-ink">
          {p.full_name}
        </Link>
        <Chip kind="reason" label={directorReason(p, execOnly.has(p.slug))} />
        {around && (
          <Chip kind="warming" label={`Warming up · around ${fmtDate(around, "month")}`} hint={warmingHint(p.scored_years, around)} />
        )}
        <span className="flex flex-wrap items-center gap-1.5">
          {p.seats.map((s) => (
            <span key={s.membership_id} className="inline-flex items-center gap-1.5">
              <Chip kind="reason" label={seatChipLabel(s, scope)} />
              <Range seat={s} />
            </span>
          ))}
        </span>
      </li>
    );
  };

  return (
    <Disclosure title={`Not ranked yet (${countLabel(people.length, total)})`}>
      <p className="text-[12px] leading-4 text-ink-3 max-w-[68ch]">
        A director is ranked with at least {MIN_DIRECTOR_YEARS} scored years. A seat is scored after a year of exact dates.
      </p>
      {warming.length > 0 && <Group title={`Needs ${MIN_DIRECTOR_YEARS} scored years (${warming.length})`}>{warming.map(row)}</Group>}
      {exec.length > 0 && <Group title={`Only exec seats (${exec.length})`}>{exec.map(row)}</Group>}
      {unscored.length > 0 && <Group title={`Only unscored seats (${unscored.length})`}>{unscored.map(row)}</Group>}
    </Disclosure>
  );
}

// ---- Seats tab ----------------------------------------------------------------------------

const REASON_ORDER = [
  "Under 1 year", "Under 1 year after listing", "≈ Dates known to the month", "≈ Dates known to the year",
  "Dates unknown", "Price history gap", "Before listing", EXEC_SEAT_REASON,
];

function looseWindow(s: SeatRef): string {
  const fmt = (iso: string | null, p: Precision | null) => (iso && p && p !== "unknown" ? fmtDate(iso, p === "day" ? "month" : p) : "?");
  return `${fmt(s.start_date, s.start_precision)} – ${s.seat_status === "current" ? "present" : fmt(s.end_date, s.end_precision)}`;
}

export function NotScoredList({ seats, total, scope }: { seats: UnscoredSeat[]; total: number; scope: RankScope }) {
  const groups = new Map<string, UnscoredSeat[]>();
  for (const s of seats) {
    const r = seatReason(s, scope);
    if (!r) continue;
    groups.set(r, [...(groups.get(r) ?? []), s]);
  }
  const shown = [...groups.values()].reduce((a, g) => a + g.length, 0);
  if (shown === 0) return null;
  const order = [...groups.keys()].sort((a, b) => {
    const ia = REASON_ORDER.indexOf(a);
    const ib = REASON_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  return (
    <Disclosure title={`Not scored (${countLabel(shown, total)})`}>
      <p className="text-[12px] leading-4 text-ink-3 max-w-[68ch]">A seat is scored after a year of exact dates.</p>
      {order.map((reason) => {
        const list = groups.get(reason)!;
        return (
          <Group key={reason} title={`${reason} (${list.length})`}>
            {list.map((s) => (
              <li key={s.membership_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <Link href={withScope(`/c/${s.company_slug}/d/${s.person_slug}`, scope)}
                      className="min-h-6 max-md:min-h-11 inline-flex items-center font-semibold text-[14px] leading-5 text-ink hover:text-accent-ink">
                  {s.full_name}
                </Link>
                <span className="text-[12px] leading-4 text-ink-3">
                  <span className="font-mono text-ink-2">{s.symbol ?? s.company_name}</span> · <span className="num">{looseWindow(s)}</span>
                </span>
                <Chip kind="reason" label={reason} />
                <Range seat={s} />
              </li>
            ))}
          </Group>
        );
      })}
    </Disclosure>
  );
}
