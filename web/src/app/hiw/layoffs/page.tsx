import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { compactMoney } from "@/lib/format";
import { fig, getHiwCases, type HiwCase } from "@/lib/queries-hiw";

export const metadata: Metadata = { title: "Layoffs" };
export const revalidate = 3600;

const people = (n: number) => Math.round(n).toLocaleString("en-US");

export default async function Layoffs() {
  const cases = await getHiwCases("layoffs");
  const jobs = cases.reduce((a, c) => a + (fig(c, "jobs_cut")?.value ?? 0), 0);
  const ceoPay = cases.reduce((a, c) => a + (fig(c, "ceo_pay")?.value ?? 0), 0);
  const buybacks = cases.reduce((a, c) => a + (fig(c, "buybacks")?.value ?? 0), 0);
  const ranked = [...cases].sort((a, b) => (fig(b, "jobs_cut")?.value ?? 0) - (fig(a, "jobs_cut")?.value ?? 0));

  return (
    <div className="space-y-10">
      <header className="max-w-[860px] space-y-4">
        <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-accent-ink">Layoffs</div>
        <h1 className="text-[40px] leading-[44px] sm:text-[60px] sm:leading-[62px] font-extrabold tracking-[-0.035em] text-ink">
          Jobs cut. <span className="text-accent-ink hiw-gold-text">Millions paid.</span>
        </h1>
        <p className="text-[17px] leading-7 text-ink-2">
          Big US companies that announced large job cuts since 2023, set beside what the CEO was paid that year and what
          the company spent buying back its own stock. Two facts per line, side by side, from the companies&apos; own filings.
        </p>
      </header>

      {cases.length === 0 ? (
        <p className="text-ink-2">Research for this section is still being checked against the filings.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-px overflow-hidden rounded-[14px] border border-line bg-line shadow-card">
            <Tile value={people(jobs)} tone="loss" label={`jobs and roles cut, as each company counted them, across ${cases.length} announcements`} />
            <Tile value={compactMoney(ceoPay)} label="paid to those companies' CEOs for the same years" />
            <Tile value={buybacks ? compactMoney(buybacks) : "—"} label="spent buying back their own stock in those years, where the 10-K says" />
          </dl>
          <ol className="space-y-4">
            {ranked.map((c) => <Row key={c.id} c={c} />)}
          </ol>
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

function Row({ c }: { c: HiwCase }) {
  const cut = fig(c, "jobs_cut"), pct = fig(c, "pct_workforce"), pay = fig(c, "ceo_pay"), prior = fig(c, "ceo_pay_prior");
  const bb = fig(c, "buybacks"), cost = fig(c, "restructuring_cost");
  return (
    <li className="rounded-[14px] border border-line bg-surface shadow-card overflow-hidden">
      <div className="grid md:grid-cols-[1.1fr_1fr]">
        <div className="min-w-0 px-5 py-4">
          <div className="flex items-center gap-2 text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">
            <Logo cik={c.cik} size={26} />
            <span className="truncate">
              {c.cik ? <Link href={`/case/${c.cik}`} className="hover:text-ink-2 underline-offset-2 hover:underline">{c.company_name}</Link> : c.company_name}
              {c.ticker && ` · ${c.ticker}`} · {c.event_date?.slice(0, 7)}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3">
            {cut && <span className="text-[34px] leading-[38px] font-black text-loss-ink num">{people(cut.value)}</span>}
            {cut && <span className="text-[13px] text-ink-3">{cut.label}</span>}
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            {pct && <span className={`${cut ? "text-[15px]" : "text-[34px] leading-[38px]"} font-black text-loss-ink num`}>{pct.value}%</span>}
            {pct && <span className="text-[13px] text-ink-3">{pct.label}</span>}
          </div>
          <p className="mt-2 text-[13px] leading-5 text-ink-2">&ldquo;{c.headline.replace(/^["“']+|["”']+$/g, "")}&rdquo;</p>
          {cost && <p className="mt-1 text-[12px] leading-4 text-ink-3">{cost.label}: {compactMoney(cost.value)}</p>}
        </div>
        <div className="min-w-0 px-5 py-4 border-t md:border-t-0 md:border-l border-line bg-surface-2 space-y-3">
          {pay && (
            <div>
              <div className="text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">
                {c.person_name ?? "The CEO"}, {pay.fiscal_year ? `FY${pay.fiscal_year}` : "that year"}
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-[28px] leading-[32px] font-black text-accent-ink num hiw-greedy w-fit origin-left">{compactMoney(pay.value)}</span>
                {prior && <span className="text-[12px] text-ink-3">FY{prior.fiscal_year}: {compactMoney(prior.value)}</span>}
              </div>
              {cut && <div className="text-[12px] leading-4 text-ink-3">{compactMoney(pay.value / cut.value)} of CEO pay per job cut</div>}
            </div>
          )}
          {bb && (
            <div>
              <div className="text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">Stock bought back{bb.fiscal_year ? `, FY${bb.fiscal_year}` : ""}</div>
              <div className="text-[22px] leading-[26px] font-extrabold text-ink num">{compactMoney(bb.value)}</div>
              {cut && <div className="text-[12px] leading-4 text-ink-3">{compactMoney(bb.value / cut.value)} per job cut</div>}
            </div>
          )}
        </div>
      </div>
      {c.notes && (
        <details className="px-5 py-2 border-t border-line text-[12px] leading-4 text-ink-3">
          <summary className="cursor-pointer select-none hover:text-ink-2">Notes on these figures</summary>
          <p className="mt-1 max-w-[90ch]">{c.notes}</p>
        </details>
      )}
      <p className="px-5 py-2 border-t border-line text-[12px] leading-4 text-ink-3">
        Sources:{" "}
        {c.source_urls.map((u, i) => (
          <a key={u} href={u} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink-2 mr-2">{i + 1}</a>
        ))}
      </p>
    </li>
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
