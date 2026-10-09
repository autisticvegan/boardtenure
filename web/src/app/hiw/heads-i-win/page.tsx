import type { Metadata } from "next";
import { CaseCard } from "@/components/hiw/case-card";
import { hundred } from "@/components/hiw/hundred";
import { getHeadsIWin, getScreenStats } from "@/lib/queries-hiw";

export const metadata: Metadata = { title: "Heads I win" };
export const revalidate = 3600;

export default async function HeadsIWin() {
  const [cases, stats] = await Promise.all([getHeadsIWin(60), getScreenStats()]);
  const pct = stats.lost_with_cap ? Math.round((stats.lost_cap_positive / stats.lost_with_cap) * 100) : null;
  return (
    <div className="space-y-8">
      <header className="max-w-[820px] space-y-3">
        <h1 className="text-[36px] leading-[40px] sm:text-[48px] sm:leading-[52px] font-extrabold tracking-[-0.03em] text-ink">
          Heads I win, tails you lose
        </h1>
        <p className="text-[16px] leading-7 text-ink-2">
          Paying executives in stock is meant to make them feel what shareholders feel. Since 2022 the SEC has required
          companies to report &ldquo;compensation actually paid&rdquo;: reported pay with every stock award re-valued at the
          year-end price, so it falls when the stock falls.
        </p>
        <p className="text-[16px] leading-7 text-ink-2">
          At the {stats.lost_with_cap.toLocaleString("en-US")} companies whose shareholders lost money over the table&apos;s
          years, the CEO&apos;s pay actually paid still added up to more than zero at{" "}
          <strong className="text-accent-ink">{pct}%</strong> of them. The median CEO kept{" "}
          <strong className="text-accent-ink">{Math.round((stats.median_cap_share_lost ?? 0) * 100)}%</strong> of reported pay
          after the re-valuation; the median shareholder kept <strong className="text-loss-ink">{hundred(stats.median_tsr_lost)}</strong> of every $100.
        </p>
        <p className="text-[12px] leading-4 text-ink-3">
          Pay actually paid re-values only awards that were unvested or vested that year, and keeps every dollar of cash.
          It leaves out shares the CEO already owned, so for executives who own large stakes it understates what they lost on
          paper. Below: the most pay actually paid where shareholders lost money.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cases.map((c, i) => <CaseCard key={c.cik} c={c} rank={i + 1} metric="cap" />)}
      </div>
    </div>
  );
}
