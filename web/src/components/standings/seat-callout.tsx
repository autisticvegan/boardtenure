// SeatCallout (rankings-ui.md §5.5): one seat as a whole-card link. Chips inside are spans.
import Link from "next/link";
import type { CompanySeat } from "@/lib/queries";
import { rankLabel, tagsFor } from "@/lib/standings";
import { Chip, Signed } from "./primitives";
import { seatWindowLabel, seatYears } from "./board-standings";

export type CalloutKicker = "Best seat" | "Toughest seat" | "Smallest beat" | "Smallest lag" | "Only scored seat";

export function SeatCallout({ kicker, seat, href, asOf }: { kicker: CalloutKicker; seat: CompanySeat; href: string; asOf: string }) {
  const tag = tagsFor(seat, 1)[0];
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-[14px] border border-line bg-surface shadow-card p-4 sm:p-5 min-h-[120px] transition-[transform,border-color] duration-[120ms] hover:-translate-y-0.5 hover:border-line-strong focus-visible:-translate-y-0.5 focus-visible:border-line-strong"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] leading-[14px] font-semibold uppercase tracking-[0.08em] text-ink-3">{kicker}</span>
        {seat.global_rank != null && (
          <span className="text-[12px] leading-4 text-ink-3 num">
            Seat {rankLabel(seat.global_rank, seat.tie)} of {seat.of}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="text-[17px] leading-6 font-[650] text-ink group-hover:text-accent-ink transition-colors">{seat.full_name}</p>
          <p className="text-[13px] leading-5 text-ink-2 num">
            {seatWindowLabel(seat)} · {seatYears(seat, asOf)} yrs
          </p>
        </div>
        <div className="text-right">
          <Signed value={seat.annualized_excess} kind="perYear" glyph size="m" />
          <p className="text-[12px] leading-4 text-ink-3">vs S&amp;P 500, per year during the seat</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[13px] leading-5 text-ink-2">
        <span className="num">
          Stock <Signed value={seat.total_return} kind="pct" /> vs S&amp;P <Signed value={seat.bench_total_return} kind="pct" />
        </span>
        {tag && <Chip kind="tag" label={tag.label} hint={tag.hint} />}
      </div>
    </Link>
  );
}
