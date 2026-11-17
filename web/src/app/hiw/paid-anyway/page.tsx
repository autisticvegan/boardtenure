import type { Metadata } from "next";
import { hundred } from "@/components/hiw/hundred";
import { PaidAnywayBrowser } from "@/components/hiw/paid-anyway-browser";
import { compactMoney } from "@/lib/format";
import { getPaidAnyway, getScreenStats } from "@/lib/queries-hiw";

export const metadata: Metadata = {
  title: "Paid anyway — big CEO pay where $100 of stock shrank below $50",
  description: "Public companies whose shareholders lost more than half in the proxy's own pay-versus-performance table, ranked by what the CEO collected over the same years.",
};
export const revalidate = 3600;

export default async function PaidAnyway() {
  const [cases, stats] = await Promise.all([getPaidAnyway(50, 60), getScreenStats()]);
  const total = cases.reduce((a, c) => a + (c.peo_sct_sum ?? 0), 0);
  return (
    <div className="space-y-8">
      <header className="max-w-[820px]">
        <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-accent-ink">Paid anyway</div>
        <h1 className="mt-1 text-[36px] leading-[40px] sm:text-[52px] sm:leading-[56px] font-extrabold tracking-[-0.035em] text-ink">
          Shareholders lost half. <span className="text-accent-ink hiw-gold-text">The checks cleared anyway.</span>
        </h1>
        <p className="mt-3 text-[16px] leading-7 text-ink-2">
          Notable companies where $100 invested at the start of their proxy&apos;s pay table was worth less than $50 at the end,
          ranked by what the CEO was reported paid over those same years. Together these {cases.length} companies reported{" "}
          <strong className="text-accent-ink">{compactMoney(total)}</strong> in CEO pay. Across all {stats.lost_half.toLocaleString("en-US")} companies
          whose shareholders lost more than half, the median CEO still collected {compactMoney(stats.median_pay_lost_half)} a year.
        </p>
        <p className="mt-2 text-[12px] leading-4 text-ink-3">
          The peer-group mark on each bar is the company&apos;s own chosen comparison; where peers fell too, part of the
          drop was the industry. Medians: shareholders kept {hundred(stats.median_tsr_lost)} of every $100 at the companies that lost money.
        </p>
      </header>
      <PaidAnywayBrowser cases={cases} />
    </div>
  );
}
