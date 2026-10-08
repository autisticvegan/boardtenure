// How the standings work (§8.1): dashboard section 8 and the methodology page's first section.
import Link from "next/link";
import type { ReactNode } from "react";
import type { LeaderboardStats, RankScope } from "@/lib/queries";
import { withScope } from "@/lib/standings";

/** `children` (the methodology page's formulas) render under the bullets, inside the card. */
export function HowItWorks({ stats, scope, methodologyHref = "/methodology", methodologyLabel = "Full methodology →", headingLevel = 2, children }: {
  stats: Pick<LeaderboardStats, "ranked_directors" | "single_seat_ranked">;
  scope: RankScope;
  methodologyHref?: string;
  methodologyLabel?: string;
  headingLevel?: 2 | 3;
  children?: ReactNode;
}) {
  const N = stats.ranked_directors;
  const single = stats.single_seat_ranked;
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby="how-it-works" className="rounded-[14px] border border-line bg-surface shadow-card p-4 md:p-5">
      <H id="how-it-works" className="text-[20px] leading-[26px] font-bold tracking-[-0.01em] text-ink">How the standings work</H>
      <ul className="mt-3 max-w-[680px] space-y-2 text-[14px] leading-[22px] text-ink-2 list-disc pl-5 marker:text-ink-3">
        <li>
          <strong className="font-semibold text-ink">Per seat:</strong> how much the stock beat or trailed the S&amp;P 500 (SPY,
          dividends reinvested) per year, from the join date to the leave date or the latest close.
        </li>
        <li>
          <strong className="font-semibold text-ink">Per director:</strong> a time-weighted average of their scored seats. A seat is
          scored after 1 year with exact dates; a director is ranked with at least 2 scored years.
        </li>
        {N > 0 && (single / N >= 0.5 ? (
          <li>
            <strong className="font-semibold text-ink">{single} of {N}</strong> ranked directors have one scored seat, so their rank
            is that seat&rsquo;s rank: mostly which company, and which years.
          </li>
        ) : (
          <li>
            <strong className="font-semibold text-ink">{N - single} of {N}</strong> ranked directors have more than one scored seat;
            seats held at the same time share market conditions.
          </li>
        ))}
        <li>
          <strong className="font-semibold text-ink">Descriptive only.</strong> A board acts as a group, and markets, sectors and
          timing drive most of any stock&rsquo;s return. A stat line about the stock, not a skill rating.
        </li>
      </ul>
      {children}
      <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px] leading-5">
        <Link href={methodologyHref} className="inline-flex items-center max-md:min-h-11 text-accent-ink hover:underline underline-offset-2">{methodologyLabel}</Link>
        {N > 0 && (
          // Plain anchor: every click must reach the route handler for a fresh pick.
          <a href={withScope("/random", scope)} className="inline-flex items-center max-md:min-h-11 text-accent-ink hover:underline underline-offset-2">
            Pick a random ranked director →
          </a>
        )}
      </p>
    </section>
  );
}
