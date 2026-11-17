import type { Metadata } from "next";
import Link from "next/link";
import { LayoffsList } from "@/components/hiw/layoffs-list";
import { compactMoney } from "@/lib/format";
import { fig, getHiwCases } from "@/lib/queries-hiw";

export const metadata: Metadata = {
  title: "Layoffs — jobs cut beside CEO pay and stock buybacks",
  description: "Large US layoff announcements since 2023 set side by side with CEO compensation and stock buybacks from each company's own SEC filings.",
};
export const revalidate = 3600;

const countFmt = (n: number) => Math.round(n).toLocaleString("en-US");

export default async function Layoffs() {
  const cases = await getHiwCases("layoffs");
  const jobs = cases.reduce((a, c) => a + (fig(c, "jobs_cut")?.value ?? 0), 0);
  const ceoPay = cases.reduce((a, c) => a + (fig(c, "ceo_pay")?.value ?? 0), 0);
  const buybacks = cases.reduce((a, c) => a + (fig(c, "buybacks")?.value ?? 0), 0);

  return (
    <div className="space-y-10">
      <header className="max-w-[860px] space-y-4">
        <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-accent-ink">Layoffs</div>
        <h1 className="text-[40px] leading-[44px] sm:text-[60px] sm:leading-[62px] font-extrabold tracking-[-0.035em] text-ink">
          Jobs cut. <span className="text-accent-ink hiw-gold-text">Millions paid.</span>
        </h1>
        <p className="text-[17px] leading-7 text-ink-2">
          When belt-tightening stops outside the boardroom: major US job-cut announcements since 2023 set right beside
          what the CEO collected that year and what the company spent buying back its own stock, straight from its 8-Ks,
          10-Ks, and proxies.
        </p>
      </header>

      {cases.length === 0 ? (
        <p className="text-ink-2">Research for this section is still being checked against the filings.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-px overflow-hidden rounded-[14px] border border-line bg-line shadow-card">
            <Tile value={countFmt(jobs)} tone="loss" label={`jobs and roles cut, as each company counted them, across ${cases.length} announcements`} />
            <Tile value={compactMoney(ceoPay)} label="paid to those companies' CEOs for the same years" />
            <Tile value={buybacks ? compactMoney(buybacks) : "—"} label="spent buying back their own stock in those years, where the 10-K says" />
          </dl>
          <LayoffsList cases={cases} />
        </>
      )}

      <p className="text-[12px] leading-4 text-ink-3 max-w-[80ch]">
        Job cuts are the company&apos;s own count or percentage, from its 8-K, 10-K or 10-Q. CEO pay is the Summary
        Compensation Table total for the fiscal year named, with stock valued when granted; buybacks are the 10-K&apos;s
        repurchases for that fiscal year. Per-job figures are simple division, shown for scale. Companies cut jobs and buy
        back stock for many reasons; these lines put the numbers next to each other and leave the judging to you.{" "}
        <Link href="/about" className="underline underline-offset-2 hover:text-ink-2">How we know</Link>
      </p>
    </div>
  );
}

function Tile({ value, label, tone }: { value: string; label: string; tone?: "loss" }) {
  return (
    <div className="flex flex-col-reverse justify-end min-w-0 bg-surface px-4 py-3 md:px-5 md:py-4">
      <dt className="mt-0.5 text-[12px] leading-4 text-ink-3">{label}</dt>
      <dd className={`text-[26px] leading-[32px] font-extrabold tracking-[-0.01em] whitespace-nowrap ${tone === "loss" ? "text-loss-ink" : "text-accent-ink"}`}>{value}</dd>
    </div>
  );
}
