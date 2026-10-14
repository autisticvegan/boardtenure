import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ceoNames, companyLabel, span } from "@/components/hiw/case-card";
import { HundredBar, hundred } from "@/components/hiw/hundred";
import { compactMoney } from "@/lib/format";
import { getScreenCase, getScreenYears } from "@/lib/queries-hiw";

export const revalidate = 3600;

export async function generateMetadata({ params }: PageProps<"/hiw/case/[cik]">): Promise<Metadata> {
  const c = await getScreenCase(Number((await params).cik));
  return c ? { title: `${companyLabel(c).name}: CEO pay vs shareholders` } : {};
}

export default async function CasePage({ params }: PageProps<"/hiw/case/[cik]">) {
  const cik = Number((await params).cik);
  if (!Number.isInteger(cik)) notFound();
  const c = await getScreenCase(cik);
  if (!c) notFound();
  const years = await getScreenYears(cik, c.accession);
  const { name, ticker } = companyLabel(c);
  const who = ceoNames(c.ceos);
  return (
    <div className="space-y-8 max-w-[960px]">
      <nav aria-label="Breadcrumb" className="text-[12px] leading-4 text-ink-3">
        <Link href="/paid-anyway" className="hover:text-ink-2">Paid anyway</Link> / {ticker ?? name}
      </nav>
      <header>
        <h1 className="text-[32px] leading-[38px] sm:text-[44px] sm:leading-[48px] font-extrabold tracking-[-0.03em] text-ink">{name}</h1>
        <p className="mt-2 text-[16px] leading-7 text-ink-2">
          {ticker && <>{ticker} · </>}From the {c.latest_frame.slice(2)} proxy&apos;s pay-versus-performance table, covering {span(c)}.
          {who && <> CEO{c.ceos.length > 1 ? "s" : ""} in those years: {who}.</>}
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-3">
        <Big value={compactMoney(c.peo_sct_sum)} label={c.ceos.length > 1 ? "reported CEO pay over these years, every CEO combined" : "reported CEO pay over these years"} />
        <Big value={compactMoney(c.peo_cap_sum)} label="CEO pay “actually paid” (stock awards at year-end value)" />
        <Big value={hundred(c.tsr_value_of_100)} label="what $100 invested at the start was worth at the end" tone={c.tsr_value_of_100 < 100 ? "loss" : "gain"} />
      </div>
      <div className="rounded-[14px] border border-line bg-surface px-5 py-4 shadow-card space-y-2">
        <HundredBar value={c.tsr_value_of_100} peer={c.peer_tsr_value_of_100} />
        <p className="text-[12px] leading-4 text-ink-3">
          Bar: this company&apos;s $100; tick: $100 start; grey mark: the peer group the company chose
          ({hundred(c.peer_tsr_value_of_100)}).
        </p>
      </div>
      <section aria-labelledby="by-year">
        <h2 id="by-year" className="text-[20px] leading-[26px] font-bold text-ink mb-3">Year by year, as filed</h2>
        <div className="relative overflow-x-auto rounded-[14px] border border-line bg-surface shadow-card" role="region" aria-label="Year by year" tabIndex={0}>
          <table className="w-full min-w-[640px] text-[13px] leading-5">
            <thead className="text-[12px] leading-4 text-ink-3 text-left">
              <tr className="border-b border-line">
                <th scope="col" className="font-medium px-4 py-3">Fiscal year ending</th>
                <th scope="col" className="font-medium px-3 py-3 text-right">CEO reported pay</th>
                <th scope="col" className="font-medium px-3 py-3 text-right">CEO pay actually paid</th>
                <th scope="col" className="font-medium px-3 py-3 text-right">Other executives (avg)</th>
                <th scope="col" className="font-medium px-4 py-3 text-right">$100 became</th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.frame} className="border-b border-line last:border-0">
                  <th scope="row" className="font-normal text-left px-4 py-2.5">{y.period_end}</th>
                  <td className="px-3 py-2.5 text-right num text-ink">{compactMoney(y.peo_sct)}</td>
                  <td className={`px-3 py-2.5 text-right num ${y.peo_cap != null && y.peo_cap < 0 ? "text-loss-ink" : "text-ink"}`}>
                    {y.peo_cap != null && y.peo_cap < 0 ? `−${compactMoney(-y.peo_cap)}` : compactMoney(y.peo_cap)}
                  </td>
                  <td className="px-3 py-2.5 text-right num text-ink-2">{compactMoney(y.other_neo_avg_sct)}</td>
                  <td className={`px-4 py-2.5 text-right num font-semibold ${(y.tsr ?? 100) < 100 ? "text-loss-ink" : "text-gain-ink"}`}>{hundred(y.tsr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] leading-4 text-ink-3">
          Figures as tagged in the filing and checked against it.{" "}
          {c.doc_url && <a href={c.doc_url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink-2">Read the proxy</a>}
        </p>
      </section>
    </div>
  );
}

function Big({ value, label, tone }: { value: string; label: string; tone?: "loss" | "gain" }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface px-5 py-4 shadow-card">
      <div className={`text-[32px] leading-[36px] font-extrabold num ${tone === "loss" ? "text-loss-ink" : tone === "gain" ? "text-gain-ink" : "text-accent-ink"}`}>{value}</div>
      <div className="mt-1 text-[12px] leading-4 text-ink-3">{label}</div>
    </div>
  );
}
