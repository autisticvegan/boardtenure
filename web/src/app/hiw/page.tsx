import Link from "next/link";
import type { ReactNode } from "react";
import { CaseCard, ceoNames, companyLabel, span } from "@/components/hiw/case-card";
import { Coin } from "@/components/hiw/coin";
import { Face } from "@/components/hiw/face";
import { FlipGame, type FlipCase } from "@/components/hiw/flip-game";
import { hundred } from "@/components/hiw/hundred";
import { Ticker } from "@/components/hiw/ticker";
import { compactMoney } from "@/lib/format";
import { getPayAsymmetry } from "@/lib/queries-pay";
import {
  getAllChutes, getExecutiveSales, getFailingUp, getHeadsIWin, getPaidAnyway, getScreenStats,
} from "@/lib/queries-hiw";

export const revalidate = 3600;

export default async function HiwHome() {
  const [stats, paid, deck, heads, chutes, sales, failing, asym] = await Promise.all([
    getScreenStats(), getPaidAnyway(50, 24), getPaidAnyway(100, 120), getHeadsIWin(3), getAllChutes(), getExecutiveSales(),
    getFailingUp(), getPayAsymmetry(),
  ]);
  const up = asym?.buckets_same.at(-1);
  const down = asym?.buckets_same[0];
  const pctAbs = (x: number | null | undefined) => `${Math.round(Math.abs((x ?? 0) * 100))}%`;
  const signedPct = (x: number | null | undefined) =>
    x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(Math.round(x * 100))}%`;
  const capPct = stats.lost_with_cap ? Math.round((stats.lost_cap_positive / stats.lost_with_cap) * 100) : null;
  const topChutes = chutes.filter((c) => (c.total ?? 0) > 0).sort((a, b) => (b.total ?? 0) - (a.total ?? 0)).slice(0, 3);
  const soldBefore = sales.filter((s) => s.value_at_end != null && s.proceeds > s.value_at_end)
    .sort((a, b) => (b.proceeds - b.value_at_end!) - (a.proceeds - a.value_at_end!)).slice(0, 3);
  const flipCases: FlipCase[] = deck.map((c) => {
    const { name, ticker } = companyLabel(c);
    return { cik: c.cik, name, ticker, ceo: ceoNames(c.ceos), pay: compactMoney(c.peo_sct_sum), tsr: hundred(c.tsr_value_of_100), span: span(c) };
  });

  return (
    <div className="space-y-14 md:space-y-20">
      <section className="pt-2 md:pt-8 grid gap-8 md:grid-cols-[1fr_auto] items-center">
        <div className="max-w-[820px]">
          <h1 className="text-[44px] leading-[46px] sm:text-[72px] sm:leading-[72px] font-black tracking-[-0.045em] text-ink">
            Heads, I win.<br /><span className="text-accent-ink">Tails, you lose.</span>
          </h1>
          <p className="mt-5 text-[18px] leading-8 text-ink-2 max-w-[60ch]">
            The stock falls. The pay doesn&apos;t. A running tally of what America&apos;s public companies paid the people
            at the top while their shareholders lost money, straight from the companies&apos; own filings.
          </p>
          <p className="mt-3 text-[13px] leading-5 text-ink-3">
            {stats.companies.toLocaleString("en-US")} companies screened · pay tables through {stats.latest_year?.slice(2)} ·{" "}
            <Link href="/about" className="underline underline-offset-2 hover:text-ink-2">how we know</Link>
          </p>
        </div>
        <div className="justify-self-center md:justify-self-end"><Coin size={168} /></div>
      </section>

      <div className="-mx-4 sm:-mx-6"><Ticker cases={paid} /></div>

      <section aria-labelledby="the-pattern" className="space-y-5">
        <h2 id="the-pattern" className="text-[28px] leading-8 sm:text-[36px] sm:leading-[40px] font-extrabold tracking-[-0.02em] text-ink">
          Shareholders lost money. <span className="text-accent-ink">CEOs mostly didn&apos;t.</span>
        </h2>
        <dl className="grid gap-px overflow-hidden rounded-[18px] border border-line bg-line shadow-card md:grid-cols-3">
          <Stat value={compactMoney(stats.median_pay_lost)}
                label={`a year, the median CEO's pay at the ${stats.lost_money.toLocaleString("en-US")} companies whose shareholders lost money`}
                sub={`${compactMoney(stats.median_pay_gained)} where shareholders came out ahead`} />
          <Stat value={capPct != null ? `${capPct}%` : "—"}
                label="of those CEOs still came out ahead, even after their stock awards were marked down"
                sub={`the median CEO kept ${Math.round((stats.median_cap_share_lost ?? 0) * 100)}% of reported pay; the median shareholder kept ${hundred(stats.median_tsr_lost)} of every $100`} />
          <Stat value={compactMoney(stats.median_pay_lost_half)}
                label={`a year, the median CEO's pay even where shareholders lost more than half (${stats.lost_half.toLocaleString("en-US")} companies)`}
                sub="losing half didn't lower it any further" />
        </dl>
      </section>

      {up && down && (
        <section aria-labelledby="the-raise" className="space-y-5">
          <Head id="the-raise" kicker="The raise" title="Heads, their pay jumps. Tails, it barely moves." href="/raise"
                sub={`The same CEO in back-to-back years at ${asym!.sample.companies.toLocaleString("en-US")} companies: the median change in pay, by what the stock did that year.`} />
          <div className="grid gap-4 md:grid-cols-2">
            <Face side="Heads" tone="gain" title={`The stock rose more than ${pctAbs(up.lo)}`} value={signedPct(up.median_change)}
                  sub={`median change in CEO pay · ${Math.round((up.share_up ?? 0) * 100)}% got a raise`} />
            <Face side="Tails" tone="loss" title={`The stock fell more than ${pctAbs(down.hi)}`} value={signedPct(down.median_change)}
                  sub={`median change in CEO pay · ${Math.round((down.share_up ?? 0) * 100)}% still got a raise`} />
          </div>
        </section>
      )}

      <FlipGame cases={flipCases} />

      <section aria-labelledby="paid-anyway" className="space-y-5">
        <Head id="paid-anyway" kicker="Paid anyway" title="Your $100 shrank. Their paycheck didn't." href="/paid-anyway"
              sub="The most CEO pay at well-known companies where $100 invested was worth less than $50 by the end." />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {paid.slice(0, 6).map((c, i) => <CaseCard key={c.cik} c={c} rank={i + 1} />)}
        </div>
      </section>

      {topChutes.length > 0 && (
        <section aria-labelledby="chutes" className="space-y-5">
          <Head id="chutes" kicker="Golden parachutes" title="The exit is the bonus." href="/parachutes"
                sub="Severance, stock that kept vesting, consulting deals: what they were handed on the way out." />
          <div className="grid gap-4 md:grid-cols-3">
            {topChutes.map((c) => (
              <Link key={c.key} href="/parachutes"
                    className="group block rounded-[18px] border border-line bg-surface px-5 py-5 shadow-card hover:border-accent/60">
                <div className="text-[11px] leading-[14px] uppercase tracking-[0.1em] text-ink-3">{c.company}</div>
                <div className="mt-1 text-[17px] leading-6 font-bold text-ink group-hover:text-accent-ink">{c.person}</div>
                <div className="mt-3 text-[34px] leading-[38px] font-black text-accent-ink num">{compactMoney(c.total)}</div>
                <div className="text-[12px] leading-4 text-ink-3">
                  on the way out{c.value_of_100 != null && <> · shareholders&apos; $100 → <span className="text-loss-ink font-semibold">{hundred(c.value_of_100)}</span></>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {soldBefore.length > 0 && (
        <section aria-labelledby="sold" className="space-y-5">
          <Head id="sold" kicker="What they sold" title="Cashed out before the drop." href="/sold"
                sub="Stock executives sold while in office, against what the same shares were worth when they left." />
          <div className="grid gap-4 md:grid-cols-3">
            {soldBefore.map((s) => (
              <Link key={`${s.company_slug}-${s.full_name}`} href="/sold"
                    className="group block rounded-[18px] border border-line bg-surface px-5 py-5 shadow-card hover:border-accent/60">
                <div className="text-[11px] leading-[14px] uppercase tracking-[0.1em] text-ink-3">{s.company_name}</div>
                <div className="mt-1 text-[17px] leading-6 font-bold text-ink group-hover:text-accent-ink">{s.full_name}</div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-[30px] leading-[34px] font-black text-accent-ink num">{compactMoney(s.proceeds)}</span>
                  <span className="text-[13px] text-ink-3">sold</span>
                </div>
                <div className="text-[12px] leading-4 text-ink-3">the same shares were worth <span className="text-loss-ink font-semibold">{compactMoney(s.value_at_end)}</span> when they left</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {heads.length > 0 && (
          <section aria-labelledby="heads" className="min-w-0 space-y-4">
            <Head id="heads" kicker="Heads I win" title="Even marked down, still way up." href="/heads-i-win"
                  sub="Shareholders lost money; CEO pay “actually paid”, with stock awards at year-end prices, still added up to this." />
            <div className="space-y-3">
              {heads.map((c) => <CaseCard key={c.cik} c={c} metric="cap" />)}
            </div>
          </section>
        )}
        {failing.length > 0 && (
          <section aria-labelledby="failing" className="min-w-0 space-y-4">
            <Head id="failing" kicker="Failing up" title="Shareholders lost. They got hired anyway." href="/failing-up"
                  sub="Shareholders lost big by one company's own figures; another company hired them as an executive next." />
            <ol className="space-y-3">
              {failing.slice(0, 3).map((f) => (
                <li key={f.id}>
                  <Link href="/failing-up" className="group flex items-center justify-between gap-4 rounded-[18px] border border-line bg-surface px-5 py-4 shadow-card hover:border-accent/60">
                    <div className="min-w-0">
                      <div className="text-[16px] leading-6 font-bold text-ink group-hover:text-accent-ink">{f.person_name}</div>
                      <div className="text-[12px] leading-4 text-ink-3 truncate">{f.from_company} → {f.to_company}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[13px] text-ink-3">$100 → <span className="text-loss-ink font-bold num">{hundred(f.from_value_of_100)}</span></div>
                      <div className="text-[13px] text-ink-3">then <span className="text-accent-ink font-bold num">{compactMoney(f.pay[0]?.total)}</span></div>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}

function Stat({ value, label, sub }: { value: ReactNode; label: string; sub: string }) {
  return (
    <div className="flex flex-col-reverse justify-end bg-surface px-6 py-6">
      <dt className="mt-2 text-[14px] leading-5 text-ink-2">
        {label}
        <span className="block mt-2 text-[12px] leading-4 text-ink-3">{sub}</span>
      </dt>
      <dd className="text-[52px] leading-[54px] font-black tracking-[-0.04em] text-accent-ink">{value}</dd>
    </div>
  );
}

function Head({ id, kicker, title, sub, href }: { id: string; kicker: string; title: string; sub: string; href: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-accent-ink">{kicker}</div>
        <h2 id={id} className="mt-1 text-[26px] leading-8 sm:text-[32px] sm:leading-[36px] font-extrabold tracking-[-0.02em] text-ink">{title}</h2>
        <p className="mt-1 text-[14px] leading-5 text-ink-2 max-w-[70ch]">{sub}</p>
      </div>
      <Link href={href} className="min-h-11 inline-flex items-center rounded-full border border-line-strong px-4 text-[13px] font-semibold text-ink-2 hover:text-ink hover:border-accent">
        See all →
      </Link>
    </div>
  );
}
