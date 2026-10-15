import type { Metadata } from "next";
import Link from "next/link";
import { companyLabel } from "@/components/hiw/case-card";
import { MakeItRain } from "@/components/hiw/greed-fx";
import { RatioPicker, type RatioRow } from "@/components/hiw/ratio-picker";
import { Logo } from "@/components/logo";
import { compactMoney } from "@/lib/format";
import { getPayRatios, getPayRatioStats } from "@/lib/queries-hiw";
import { caughtUpAt, ratioLabel, startedIn } from "@/lib/ratio";

export const metadata: Metadata = { title: "The ratio" };
export const revalidate = 3600;

const TOP = 30;

export default async function Ratio() {
  const [rows, stats] = await Promise.all([getPayRatios(), getPayRatioStats()]);
  if (rows.length === 0) return <p className="text-ink-2">No pay ratios on file yet.</p>;
  const picker: RatioRow[] = rows.map((r) => {
    const { name, ticker } = companyLabel(r);
    return { cik: r.cik, name, ticker, year: r.fiscal_year, ratio: r.ratio, ceo: r.ceo_pay, median: r.median_pay, url: r.doc_url };
  });
  const top = rows.slice(0, TOP);
  const humble = [...rows].reverse().slice(0, 6);
  const max = Math.log10(top[0].ratio);

  return (
    <div className="space-y-12">
      <header className="max-w-[880px] space-y-4">
        <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-accent-ink">The ratio</div>
        <h1 className="text-[40px] leading-[44px] sm:text-[60px] sm:leading-[62px] font-extrabold tracking-[-0.035em] text-ink">
          By <span className="text-accent-ink hiw-gold-text">{caughtUpAt(stats.median)}</span>, the CEO has made your whole year.
        </h1>
        <p className="text-[17px] leading-7 text-ink-2">
          Most US public companies have to publish how their CEO&apos;s pay compares with their median employee&apos;s. At the
          median of {stats.n.toLocaleString("en-US")} well-known companies the CEO made{" "}
          <strong className="text-ink">{Math.round(stats.median)} times</strong> as much, against a median worker&apos;s{" "}
          <strong className="text-ink">{compactMoney(stats.median_worker)}</strong>. If pay arrived evenly through the year,
          that CEO had earned the worker&apos;s entire year by {caughtUpAt(stats.median).replace(/\.$/, "")}.
        </p>
        <MakeItRain label="Make it rain (on the CEO)" />
      </header>

      <RatioPicker rows={picker} />

      <section aria-labelledby="top" className="space-y-4">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-accent-ink">The top {TOP}</div>
          <h2 id="top" className="mt-1 text-[28px] leading-8 sm:text-[32px] sm:leading-[36px] font-extrabold tracking-[-0.02em] text-ink">
            Highest CEO pay ratios
          </h2>
          <p className="mt-1 text-[14px] leading-5 text-ink-2 max-w-[70ch]">
            Bars are drawn on a log scale, or the top few wouldn&apos;t leave room for anyone else.
          </p>
        </div>
        <ol className="space-y-2">
          {top.map((r, i) => {
            const { name, ticker } = companyLabel(r);
            return (
              <li key={r.cik} className="grid grid-cols-[2rem_minmax(0,1fr)] sm:grid-cols-[2rem_minmax(0,16rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-[12px] border border-line bg-surface px-3 py-2.5">
                <span className="text-[13px] font-bold text-accent-ink num">#{i + 1}</span>
                <span className="flex items-center gap-2 min-w-0">
                  <Logo cik={r.cik} size={24} />
                  <span className="min-w-0">
                    <span className="block text-[14px] leading-5 font-semibold text-ink truncate">{name}</span>
                    <span className="block text-[11px] leading-4 text-ink-3">{ticker ?? "—"} · CEO {compactMoney(r.ceo_pay)} · median worker {compactMoney(r.median_pay)}</span>
                  </span>
                </span>
                <span aria-hidden className="col-start-2 sm:col-start-auto h-3 rounded-full bg-surface-3 overflow-hidden">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (Math.log10(r.ratio) / max) * 100)}%` }} />
                </span>
                <span className="col-start-2 sm:col-start-auto text-[16px] font-black text-accent-ink num whitespace-nowrap">{ratioLabel(r.ratio)}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="humble" className="space-y-4">
        <div>
          <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-gain-ink">The humble ones</div>
          <h2 id="humble" className="mt-1 text-[28px] leading-8 font-extrabold tracking-[-0.02em] text-ink">The lowest ratios</h2>
          <p className="mt-1 text-[14px] leading-5 text-ink-2 max-w-[70ch]">
            Often a CEO who takes a token salary and already owns a large stake, so the ratio says little about what they
            gain when the stock rises.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {humble.map((r) => {
            const { name } = companyLabel(r);
            return (
              <li key={r.cik} className="flex items-center gap-3 rounded-[12px] border border-gain/30 bg-surface px-4 py-3">
                <Logo cik={r.cik} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] leading-5 font-semibold text-ink truncate">{name}</span>
                  <span className="block text-[11px] leading-4 text-ink-3">CEO {compactMoney(r.ceo_pay)} · median {compactMoney(r.median_pay)}</span>
                </span>
                <span className="text-[16px] font-black text-gain-ink num">{ratioLabel(r.ratio)}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="text-[12px] leading-4 text-ink-3 max-w-[80ch]">
        From each company&apos;s latest proxy (Item 402(u) of Regulation S-K): {stats.n_all.toLocaleString("en-US")} companies
        whose CEO pay and median employee pay, printed in the same passage, reproduce the ratio they state; the lists show
        companies with a public float of at least $500M (median ratio across all {stats.n_all.toLocaleString("en-US")}:{" "}
        {Math.round(stats.median_all)}:1). Companies choose how to identify the median employee, and many include part-time
        and overseas staff, which lowers the median. The CEO figure is the Summary Compensation Table total, with stock
        valued when granted. &ldquo;Caught up by&rdquo; assumes pay arrives evenly through the year; &ldquo;would have had
        to start in&rdquo; is the ratio counted back from {startedIn(0)}. <Link href="/about" className="underline underline-offset-2 hover:text-ink-2">How we know</Link>
      </p>
    </div>
  );
}
