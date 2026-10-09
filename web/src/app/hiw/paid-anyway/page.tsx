import type { Metadata } from "next";
import { CaseCard } from "@/components/hiw/case-card";
import { hundred } from "@/components/hiw/hundred";
import { compactMoney } from "@/lib/format";
import { getPaidAnyway, getScreenStats } from "@/lib/queries-hiw";

export const metadata: Metadata = { title: "Paid anyway" };
export const revalidate = 3600;

export default async function PaidAnyway() {
  const [cases, stats] = await Promise.all([getPaidAnyway(50, 60), getScreenStats()]);
  const total = cases.reduce((a, c) => a + (c.peo_sct_sum ?? 0), 0);
  return (
    <div className="space-y-8">
      <header className="max-w-[820px]">
        <h1 className="text-[36px] leading-[40px] sm:text-[48px] sm:leading-[52px] font-extrabold tracking-[-0.03em] text-ink">Paid anyway</h1>
        <p className="mt-3 text-[16px] leading-7 text-ink-2">
          Companies where $100 invested at the start of their proxy&apos;s pay table was worth less than $50 at the end,
          ranked by what the CEO was reported paid over those same years. These {cases.length} companies paid their CEOs{" "}
          <strong className="text-accent-ink">{compactMoney(total)}</strong>. Across all {stats.lost_half.toLocaleString("en-US")} companies
          whose shareholders lost more than half, the median CEO was still paid {compactMoney(stats.median_pay_lost_half)} a year.
        </p>
        <p className="mt-2 text-[12px] leading-4 text-ink-3">
          The peer-group line on each bar is the company&apos;s own chosen comparison; where peers fell too, part of the
          drop was the industry. Medians: shareholders kept {hundred(stats.median_tsr_lost)} of every $100 at the companies that lost money.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cases.map((c, i) => <CaseCard key={c.cik} c={c} rank={i + 1} />)}
      </div>
    </div>
  );
}
