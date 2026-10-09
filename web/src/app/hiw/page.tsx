import Link from "next/link";
import type { ReactNode } from "react";
import { CaseCard } from "@/components/hiw/case-card";
import { hundred } from "@/components/hiw/hundred";
import { compactMoney } from "@/lib/format";
import { getHeadsIWin, getPaidAnyway, getParachutes, getScreenStats } from "@/lib/queries-hiw";

export const revalidate = 3600;

export default async function HiwHome() {
  const [stats, paid, heads, chutes] = await Promise.all([
    getScreenStats(), getPaidAnyway(50, 6), getHeadsIWin(3), getParachutes(),
  ]);
  const capPct = stats.lost_with_cap ? Math.round((stats.lost_cap_positive / stats.lost_with_cap) * 100) : null;
  const topChutes = chutes.filter((c) => (c.total_exit_pay ?? 0) > 0).slice(0, 3);

  return (
    <div className="space-y-12 md:space-y-16">
      <section className="pt-2 md:pt-6 max-w-[880px]">
        <h1 className="text-[40px] leading-[44px] sm:text-[60px] sm:leading-[62px] font-extrabold tracking-[-0.035em] text-ink">
          Heads, I win.<br /><span className="text-accent-ink">Tails, you lose.</span>
        </h1>
        <p className="mt-4 text-[17px] leading-7 text-ink-2 max-w-[66ch]">
          What US public companies paid their CEOs, set against what their shareholders got. Every figure is from the
          company&apos;s own proxy statement: {stats.companies.toLocaleString("en-US")} companies, the years their pay
          tables cover, through {stats.latest_year?.slice(2)}.
        </p>
      </section>

      <section aria-labelledby="the-pattern" className="space-y-4">
        <h2 id="the-pattern" className="text-[22px] leading-7 font-bold text-ink">The pattern</h2>
        <dl className="grid gap-px overflow-hidden rounded-[14px] border border-line bg-line shadow-card md:grid-cols-3">
          <Stat value={compactMoney(stats.median_pay_lost)}
                label={`median CEO pay per year at the ${stats.lost_money.toLocaleString("en-US")} companies whose shareholders lost money`}
                sub={`vs ${compactMoney(stats.median_pay_gained)} where shareholders gained`} />
          <Stat value={capPct != null ? `${capPct}%` : "—"}
                label="of those CEOs still came out ahead on pay “actually paid”, which marks their stock awards to market"
                sub={`median CEO kept ${Math.round((stats.median_cap_share_lost ?? 0) * 100)}% of reported pay; the median shareholder kept ${hundred(stats.median_tsr_lost)} of every $100`} />
          <Stat value={compactMoney(stats.median_pay_lost_half)}
                label={`median CEO pay per year where shareholders lost more than half (${stats.lost_half.toLocaleString("en-US")} companies)`}
                sub={`about the same as where they lost less: losing half or more didn't lower the median further`} />
        </dl>
        <p className="text-[12px] leading-4 text-ink-3 max-w-[80ch]">
          Companies whose proxy table covers at least three years with a CEO figure for each
          ({stats.full_tables.toLocaleString("en-US")} companies). Pay is the Summary Compensation Table total; &ldquo;$100
          became&rdquo; is the company&apos;s own cumulative shareholder return over the same table.{" "}
          <Link href="/about" className="underline underline-offset-2 hover:text-ink-2">How we know</Link>
        </p>
      </section>

      <section aria-labelledby="paid-anyway" className="space-y-4">
        <Head id="paid-anyway" title="Paid anyway" href="/paid-anyway"
              sub="The most CEO pay at companies where $100 invested was worth less than $50 by the end." />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {paid.map((c, i) => <CaseCard key={c.cik} c={c} rank={i + 1} />)}
        </div>
      </section>

      <section aria-labelledby="heads" className="space-y-4">
        <Head id="heads" title="Heads I win" href="/heads-i-win"
              sub="Shareholders lost money, and CEO pay “actually paid” (stock awards valued at year-end prices) still added up to this." />
        <div className="grid gap-4 md:grid-cols-3">
          {heads.map((c) => <CaseCard key={c.cik} c={c} metric="cap" />)}
        </div>
      </section>

      {topChutes.length > 0 && (
        <section aria-labelledby="chutes" className="space-y-4">
          <Head id="chutes" title="Golden parachutes" href="/parachutes"
                sub="What departing executives were paid on the way out, beside the stock while they served." />
          <div className="grid gap-4 md:grid-cols-3">
            {topChutes.map((c) => (
              <Link key={`${c.company_slug}-${c.full_name}`} href="/parachutes"
                    className="block rounded-[14px] border border-line bg-surface px-5 py-4 shadow-card hover:border-line-strong">
                <div className="text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">{c.company_name} · {c.role}</div>
                <div className="mt-1 text-[16px] leading-6 font-semibold text-ink">{c.full_name}</div>
                <div className="mt-2 text-[28px] leading-[32px] font-extrabold text-accent-ink num">{compactMoney(c.total_exit_pay)}</div>
                <div className="text-[12px] leading-4 text-ink-3">on the way out</div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ value, label, sub }: { value: ReactNode; label: string; sub: string }) {
  return (
    <div className="flex flex-col-reverse justify-end bg-surface px-5 py-5">
      <dt className="mt-2 text-[13px] leading-5 text-ink-2">
        {label}
        <span className="block mt-1 text-[12px] leading-4 text-ink-3">{sub}</span>
      </dt>
      <dd className="text-[40px] leading-[44px] font-extrabold tracking-[-0.03em] text-accent-ink">{value}</dd>
    </div>
  );
}

function Head({ id, title, sub, href }: { id: string; title: string; sub: string; href: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
      <div>
        <h2 id={id} className="text-[22px] leading-7 font-bold text-ink">{title}</h2>
        <p className="mt-1 text-[13px] leading-5 text-ink-2 max-w-[70ch]">{sub}</p>
      </div>
      <Link href={href} className="text-[13px] font-semibold text-accent-ink hover:underline underline-offset-2">See all →</Link>
    </div>
  );
}
