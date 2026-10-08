// Director page hero (docs/design/rankings-ui.md §5.5): rank first, then the score, then the luck.
import Link from "next/link";
import type { ReactNode } from "react";
import { fmtDate } from "@/lib/format";
import type { RankScope, ScopedDirector, SeatRef } from "@/lib/queries";
import {
  CHIP_HINT, directorReason, eligibleAround, floorYears, onlyExecSeats, rankLabel, SCOPE_LABEL, seatReason, shortRecord,
  topPct, warmingHint, withScope,
} from "@/lib/standings";
import { Chip, RankBadge, ScopeToggle, Signed } from "./primitives";

const otherScope = (s: RankScope): RankScope => (s === "all" ? "independent" : "all");

function OtherScopeLine({ slug, scope, ranked, other }: {
  slug: string; scope: RankScope; ranked: ScopedDirector | null; other: ScopedDirector | null;
}) {
  const os = otherScope(scope);
  const href = withScope(`/d/${slug}`, os);
  if (other) {
    if (ranked && ranked.rank === other.rank && ranked.tie === other.tie) return null;
    return (
      <Link href={href} className="text-[13px] leading-5 text-ink-2 hover:text-accent-ink">
        <span className="num">{rankLabel(other.rank, other.tie)} of {other.of}</span> with {SCOPE_LABEL[os]} →
      </Link>
    );
  }
  return <p className="text-[13px] leading-5 text-ink-3">Not ranked with {SCOPE_LABEL[os]}</p>;
}

/** Caption under the hero figure; the stock is the subject. */
function caption(d: ScopedDirector): string {
  const seats = d.companies.filter((s) => s.in_scope);
  const syms = [...new Set(seats.map((s) => s.symbol ?? s.company_name))];
  const verb = d.score < 0 ? "trailed" : "beat";
  if (d.scored_seats <= 1) return `${syms[0] ?? "The stock"} ${verb} the S&P 500 by this much per year during the seat.`;
  const subject = syms.length === 1 ? syms[0] : "Stocks";
  return `${subject} ${verb} the S&P 500 by this much per year, time-weighted across ${d.scored_seats} scored seats.`;
}

function FactChips({ d, scope }: { d: ScopedDirector; scope: RankScope }) {
  const seats = d.companies.filter((s) => s.in_scope);
  const ipo = seats.find((s) => s.start_anchor_reason === "first_trade");
  const exec = scope === "all" ? seats.find((s) => s.executive_seat) : undefined;
  const chips: ReactNode[] = [];
  if (shortRecord(d)) chips.push(<Chip interactive key="short" kind="short" label="Short record" hint={CHIP_HINT.short} />);
  if (ipo) chips.push(<Chip interactive key="ipo" kind="ipo" label="From IPO" hint={CHIP_HINT.ipo(ipo.start_anchor_date)} />);
  if (exec) chips.push(<Chip interactive key="exec" kind="exec" label="Exec seat" hint={CHIP_HINT.exec(exec.executive_title)} />);
  return chips.length ? <span className="flex flex-wrap items-center gap-1.5">{chips}</span> : null;
}

export function RankHero({ person, meta, ranked, other, scope, seats, dataThrough }: {
  person: { slug: string; full_name: string };
  meta?: ReactNode;
  ranked: ScopedDirector | null;
  other: ScopedDirector | null;
  scope: RankScope;
  seats: SeatRef[]; // every seat, scope-resolved
  dataThrough: string | null;
}) {
  return (
    <header className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <p className="text-[11px] leading-[14px] font-semibold uppercase tracking-[0.08em] text-ink-3">Director</p>
          <h1 className="mt-1.5 text-[26px] leading-8 md:text-[32px] md:leading-[38px] font-bold tracking-[-0.02em] text-ink">
            {person.full_name}
          </h1>
          {meta}
        </div>
        <div className="w-full sm:w-auto sm:shrink-0">
          <ScopeToggle scope={scope} hrefFor={(s) => withScope(`/d/${person.slug}`, s)} />
        </div>
      </div>

      <section aria-label="Standing" className="rounded-[14px] border border-line bg-surface shadow-card p-4 md:p-6">
        {ranked ? (
          <Ranked d={ranked} other={other} scope={scope} slug={person.slug} />
        ) : (
          <NotRanked person={person} other={other} scope={scope} seats={seats} dataThrough={dataThrough} />
        )}
      </section>
    </header>
  );
}

function Ranked({ d, other, scope, slug }: { d: ScopedDirector; other: ScopedDirector | null; scope: RankScope; slug: string }) {
  const top = topPct(d.rank, d.of);
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] leading-5 text-ink-2">
          <RankBadge rank={d.rank} tie={d.tie} of={d.of} medal size="lg" />
          <span className="num">of {d.of} ranked directors</span>
          {top != null && <><span aria-hidden className="text-ink-3">·</span><span>top {top}%</span></>}
          <span aria-hidden className="text-ink-3">·</span>
          <span>{SCOPE_LABEL[scope]}</span>
        </p>
        <OtherScopeLine slug={slug} scope={scope} ranked={d} other={other} />
      </div>
      <div>
        <Signed value={d.score} glyph size="xl" />
        <p className="mt-1 text-[13px] leading-5 text-ink-2 max-w-[52ch]">{caption(d)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] leading-5 text-ink-2">
        <span className="num">
          {d.beat_seats} of {d.scored_seats} seats beat the S&amp;P · {floorYears(d.scored_years)} scored yrs ·{" "}
          {d.scored_boards} board{d.scored_boards === 1 ? "" : "s"}
        </span>
        <FactChips d={d} scope={scope} />
      </div>
    </div>
  );
}

function NotRanked({ person, other, scope, seats, dataThrough }: {
  person: { slug: string; full_name: string }; other: ScopedDirector | null; scope: RankScope; seats: SeatRef[];
  dataThrough: string | null;
}) {
  const measurable = seats.some((s) => s.perf_status === "ok" || s.perf_status === "approximate");
  const reasons = [...new Set(seats.map((s) => seatReason(s, scope)).filter((r): r is string => r != null))];

  if (!measurable) {
    return (
      <div className="space-y-3">
        <p className="text-[15px] leading-6 text-ink">None of {person.full_name}&rsquo;s seats can be measured yet.</p>
        {reasons.length > 0 && (
          <p className="flex flex-wrap gap-1.5">{reasons.map((r) => <Chip key={r} kind="reason" label={r} />)}</p>
        )}
        {other && <OtherScopeLine slug={person.slug} scope={scope} ranked={null} other={other} />}
      </div>
    );
  }

  const scoredYears = seats.filter((s) => s.in_scope).reduce((a, s) => a + (s.calendar_days ?? 0), 0) / 365.25;
  // Deliberate deviation from §5.5: someone whose only scored seats are exec seats isn't "warming up"
  // under Non-exec seats; they're ranked under All seats, so the hero says so instead.
  const execOnly = onlyExecSeats(seats, scope);
  const around = !execOnly && dataThrough ? eligibleAround(seats, dataThrough, scope) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-[20px] leading-[26px] font-bold tracking-[-0.01em] text-ink">
          {execOnly ? `Not ranked with ${SCOPE_LABEL[scope]}` : "Not ranked yet"}
        </h2>
        {!execOnly && (
          <Chip interactive kind="warming" label="Warming up" hint={warmingHint(scoredYears, around)} />
        )}
      </div>
      <p className="text-[13px] leading-5 text-ink-2 max-w-[60ch]">
        {execOnly
          ? "Exec seats are left out of Non-exec seats scores; they count under All seats."
          : <>{directorReason({ scored_years: scoredYears })}.{around && <> Could be ranked around {fmtDate(around, "month")} if the seat continues.</>}</>}
      </p>
      <p className="text-[40px] leading-[44px] font-extrabold text-ink-3">
        <span aria-hidden>—</span><span className="sr-only">No score in {SCOPE_LABEL[scope]}</span>
      </p>
      <OtherScopeLine slug={person.slug} scope={scope} ranked={null} other={other} />
    </div>
  );
}
