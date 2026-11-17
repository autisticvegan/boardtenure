// Dashboard teaser for the cross-company pay page.
import Link from "next/link";
import { SectionHead, Signed } from "@/components/standings/primitives";
import { compactMoney } from "@/lib/format";
import { getAllExecPay, getPayAsymmetry, getPayCompaniesOverview } from "@/lib/queries-pay";
import { median } from "@/lib/track-record";

export async function PayTeaser() {
  const [companies, execs, asym] = await Promise.all([getPayCompaniesOverview(), getAllExecPay(), getPayAsymmetry()]);
  const up = asym?.buckets_same.at(-1);
  const down = asym?.buckets_same[0];
  if (companies.length === 0) return null;
  const scored = execs.filter((e) => (e.calendar_days ?? 0) >= 365 && e.annualized_excess != null);
  const topTrailed = scored.find((e) => e.annualized_excess! < 0); // rows arrive by pay per year, highest first
  const topBeat = scored.find((e) => e.annualized_excess! > 0);
  const ceoMedian = median(execs.filter((e) => e.is_ceo).map((e) => e.pay_per_year ?? 0));
  return (
    <section aria-labelledby="pay-teaser">
      <SectionHead id="pay-teaser" title="Pay vs the stock"
                   sub="What companies paid their top executives, against how the stock did while they were paid."
                   action={<Link href="/pay" className="text-accent-ink hover:underline underline-offset-2">All executive pay →</Link>} />
      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/pay" className="block rounded-[14px] border border-line bg-surface px-5 py-4 shadow-card hover:border-line-strong">
          <span className="block text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">Median CEO pay per year</span>
          <span className="block mt-2 text-[32px] leading-[36px] font-extrabold tracking-[-0.02em] text-ink">{compactMoney(ceoMedian)}</span>
          <span className="block mt-1 text-[12px] leading-4 text-ink-3">{companies.map((c) => c.symbol ?? c.common_name).join(" · ")}</span>
        </Link>
        {topTrailed && (
          <Link href={`/c/${topTrailed.company_slug}/pay`} className="block rounded-[14px] border border-line bg-surface px-5 py-4 shadow-card hover:border-line-strong">
            <span className="block text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">Most pay while the stock trailed</span>
            <span className="block mt-1 text-[15px] leading-5 font-semibold text-ink">{topTrailed.full_name}</span>
            <span className="mt-1 flex items-baseline gap-3">
              <span className="text-[24px] leading-[30px] font-bold text-ink">{compactMoney(topTrailed.pay_per_year)}/yr</span>
              <Signed value={topTrailed.annualized_excess} kind="perYear" glyph />
            </span>
            <span className="block mt-1 text-[12px] leading-4 text-ink-3">{topTrailed.company_name} vs the S&amp;P 500</span>
          </Link>
        )}
        {topBeat && (
          <Link href={`/c/${topBeat.company_slug}/pay`} className="block rounded-[14px] border border-line bg-surface px-5 py-4 shadow-card hover:border-line-strong">
            <span className="block text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">Most pay while the stock beat</span>
            <span className="block mt-1 text-[15px] leading-5 font-semibold text-ink">{topBeat.full_name}</span>
            <span className="mt-1 flex items-baseline gap-3">
              <span className="text-[24px] leading-[30px] font-bold text-ink">{compactMoney(topBeat.pay_per_year)}/yr</span>
              <Signed value={topBeat.annualized_excess} kind="perYear" glyph />
            </span>
            <span className="block mt-1 text-[12px] leading-4 text-ink-3">{topBeat.company_name} vs the S&amp;P 500</span>
          </Link>
        )}
      </div>
      {up && down && asym && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Link href="/pay/asymmetry"
                className="group flex flex-col justify-between gap-2 rounded-[14px] border border-line bg-surface px-5 py-4 shadow-card hover:border-line-strong">
            <span className="text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">
              Market-wide · {asym.sample.companies.toLocaleString("en-US")} companies, same CEO year to year
            </span>
            <span className="text-[15px] leading-6 text-ink">
              Stock up more than {Math.round((up.lo ?? 0) * 100)}% in a year: median CEO pay{" "}
              <Signed value={up.median_change} kind="pct" className="font-semibold" />. Down more than{" "}
              {Math.round(Math.abs(down.hi ?? 0) * 100)}%: <Signed value={down.median_change} kind="pct" className="font-semibold" />,
              and {Math.round((down.share_up ?? 0) * 100)}% still got a raise.
            </span>
            <span className="text-[13px] font-semibold text-accent-ink group-hover:underline underline-offset-2">See the asymmetry test →</span>
          </Link>
          <Link href="/hiw"
                className="group flex flex-col justify-between gap-2 rounded-[14px] border border-line bg-surface px-5 py-4 shadow-card hover:border-line-strong">
            <span className="text-[11px] leading-[14px] uppercase tracking-[0.08em] text-accent-ink font-semibold">
              Companion site · Heads I Win
            </span>
            <span className="text-[15px] leading-6 font-semibold text-ink">
              Heads, I win. Tails, you lose: golden parachutes, golden hellos, layoffs, and CEOs paid anyway.
            </span>
            <span className="text-[13px] font-semibold text-accent-ink group-hover:underline underline-offset-2">Open Heads I Win →</span>
          </Link>
        </div>
      )}
    </section>
  );
}
