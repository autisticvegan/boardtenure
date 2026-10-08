// Seat-level chips for the director and seat pages (docs/design/rankings-ui.md §5.2, §5.5).
import Link from "next/link";
import type { RankScope, SeatRef } from "@/lib/queries";
import { seatReason, tagsFor, withScope, type Tag } from "@/lib/standings";
import { Chip, Signed } from "./primitives";

/** Lower-case reason for inline use: "under 1 yr", "dates unknown", "exec seat". */
export function shortReason(reason: string): string {
  if (reason === "Under 1 year") return "under 1 yr";
  if (reason === "Under 1 year after listing") return "under 1 yr after listing";
  if (reason.startsWith("Exec seat")) return "exec seat";
  if (reason.startsWith("≈ ")) return `≈ ${reason.charAt(2).toLowerCase()}${reason.slice(3)}`;
  return reason.charAt(0).toLowerCase() + reason.slice(1);
}

const abs1 = (x: number) => Math.abs(x * 100).toFixed(1);

function tagSentence(tag: Tag, sym: string, seat: { annualized_excess: number | null; max_drawdown: number | null }): string {
  switch (tag.key) {
    case "white-knuckle":
      return `${sym} fell ${abs1(seat.max_drawdown ?? 0)}% from a peak during this seat, and still beat the S&P 500.`;
    case "rocket":
      return `${sym} beat the S&P 500 by ${abs1(seat.annualized_excess ?? 0)}% a year during this seat.`;
    case "rough":
      return `${sym} trailed the S&P 500 by ${abs1(seat.annualized_excess ?? 0)}% a year during this seat.`;
  }
}

/** Up to 2 rule-based tags, each with its rule in a tooltip and a plain sentence beside it. */
export function TenureTags({ seat, sym }: {
  seat: { annualized_excess: number | null; max_drawdown: number | null; relative_return_pp: number | null };
  sym: string;
}) {
  const tags = tagsFor(seat, 2);
  if (tags.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" aria-label="Seat tags">
      {tags.map((t) => (
        <li key={t.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-5 text-ink-2">
          <Chip interactive kind="tag" label={t.label} hint={t.hint} />
          <span>{tagSentence(t, sym, seat)}</span>
        </li>
      ))}
    </ul>
  );
}

/** One link-chip per other seat: "NFLX +9.4%/yr", outlined when the seat isn't in this scope's score. */
export function SeatChips({ seats, personSlug, scope }: { seats: SeatRef[]; personSlug: string; scope: RankScope }) {
  if (seats.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {seats.map((s) => {
        const reason = seatReason(s, scope);
        const scored = s.rank_eligible && s.annualized_excess != null;
        const sym = s.symbol ?? s.company_name;
        return (
          <li key={s.membership_id}>
            <Link
              href={withScope(`/c/${s.company_slug}/d/${personSlug}`, scope)}
              className={`inline-flex items-center gap-2 min-h-9 max-md:min-h-11 rounded-full px-3 text-[13px] leading-5 transition-colors hover:bg-surface-2 hover:border-line-strong ${
                reason ? "border border-dashed border-line-strong text-ink-2" : "border border-line bg-surface text-ink"
              }`}
            >
              <span className="font-mono text-[12px] font-medium">{sym}</span>
              {scored && <Signed value={s.annualized_excess} />}
              {reason && <span className="text-ink-3">· {shortReason(reason)}</span>}
              <span className="sr-only"> seat at {s.company_name}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
