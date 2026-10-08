// Seat page rank line (docs/design/rankings-ui.md §4.5): "Seat #8 of 159 · top 5% · Non-exec seats",
// or one chip saying why the seat isn't scored. Ranks come from SQL (getSeatRank).
import Link from "next/link";
import type { RankScope, SeatRank, SeatRef } from "@/lib/queries";
import { CHIP_HINT, rankLabel, SCOPE_LABEL, seatReason, srRank, topPct, withScope } from "@/lib/standings";
import { Chip } from "./primitives";
import { shortReason } from "./seat-chips";
import { spanLength } from "./seat-summary";

const otherScope = (s: RankScope): RankScope => (s === "all" ? "independent" : "all");

/** "under 1 year (8 months so far)", "under 1 year after listing (8 months)", "exec seat · counted under All seats". */
function notScoredLabel(seat: SeatRef, scope: RankScope): string {
  const reason = seatReason(seat, scope) ?? "not scored";
  if (reason.startsWith("Under 1 year") && seat.calendar_days != null) {
    const len = spanLength(seat.calendar_days);
    return `${reason.charAt(0).toLowerCase()}${reason.slice(1)} (${seat.seat_status === "current" ? `${len} so far` : len})`;
  }
  if (reason.startsWith("Exec seat")) return "exec seat · counted under All seats";
  return shortReason(reason);
}

export function SeatRankChips({ seat, rank, otherRank, scope, href }: {
  seat: SeatRef | null;
  rank: SeatRank | null; // this scope
  otherRank: SeatRank | null; // the other scope
  scope: RankScope;
  href: string; // this seat page's path, for the other-scope link
}) {
  const os = otherScope(scope);
  const facts = seat && (
    <>
      {seat.seat_status === "current" && <Chip interactive kind="current" label="Current" hint={CHIP_HINT.current} />}
      {seat.start_anchor_reason === "first_trade" && (
        <Chip interactive kind="ipo" label="From IPO" hint={CHIP_HINT.ipo(seat.start_anchor_date)} />
      )}
      {seat.executive_seat && <Chip interactive kind="exec" label="Exec seat" hint={CHIP_HINT.exec(seat.executive_title)} />}
    </>
  );

  if (rank) {
    const top = topPct(rank.rank, rank.of);
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[13px] leading-5 text-ink-2">
        <span className="inline-flex items-center h-7 rounded-md bg-surface-3 px-2.5 text-[13px] font-bold text-ink num">
          <span aria-hidden>Seat {rankLabel(rank.rank, rank.tie)} of {rank.of}</span>
          <span className="sr-only">Seat rank: {srRank(rank.rank, rank.tie)}, out of {rank.of} scored seats</span>
        </span>
        {top != null && <><span aria-hidden className="text-ink-3">·</span><span>top {top}%</span></>}
        <span aria-hidden className="text-ink-3">·</span>
        <span>{SCOPE_LABEL[scope]}</span>
        {facts}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[13px] leading-5 text-ink-2">
      <Chip kind="reason" label={`Not scored · ${seat ? notScoredLabel(seat, scope) : "not measured yet"}`} />
      {facts}
      {otherRank && (
        <Link href={withScope(href, os)} className="text-ink-2 hover:text-accent-ink">
          <span className="num">Seat {rankLabel(otherRank.rank, otherRank.tie)} of {otherRank.of}</span> with {SCOPE_LABEL[os]} →
        </Link>
      )}
    </div>
  );
}
