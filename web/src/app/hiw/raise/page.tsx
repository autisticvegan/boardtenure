import type { Metadata } from "next";
import Link from "next/link";
import { companyLabel } from "@/components/hiw/case-card";
import { Face } from "@/components/hiw/face";
import { Logo } from "@/components/logo";
import { compactMoney } from "@/lib/format";
import { getRaisesAnyway } from "@/lib/queries-hiw";
import { getPayAsymmetry } from "@/lib/queries-pay";

export const metadata: Metadata = { title: "The raise" };
export const revalidate = 3600;

const DROP = 0.3;
const pctAbs = (x: number | null | undefined, d = 0) => (x == null ? "—" : `${Math.abs(x * 100).toFixed(d)}%`);
const signed = (x: number | null | undefined, d = 0) =>
  x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(d)}%`;

export default async function Raise() {
  const [a, raises] = await Promise.all([getPayAsymmetry(), getRaisesAnyway(DROP, 30)]);
  if (!a || !a.same_year.terms) return <p className="text-ink-2">Not computed yet.</p>;
  const heads = a.buckets_same[a.buckets_same.length - 1];
  const tails = a.buckets_same[0];

  return (
    <div className="space-y-12">
      <header className="max-w-[860px] space-y-4">
        <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-accent-ink">The raise</div>
        <h1 className="text-[40px] leading-[44px] sm:text-[60px] sm:leading-[62px] font-extrabold tracking-[-0.035em] text-ink">
          The stock fell. <span className="text-accent-ink hiw-gold-text">The pay went up.</span>
        </h1>
        <p className="text-[17px] leading-7 text-ink-2">
          Same CEO, back-to-back years, {a.sample.companies.toLocaleString("en-US")} companies, straight from each
          company&apos;s own pay-versus-performance table. When the stock has a great year, the CEO&apos;s pay jumps. When
          it has a terrible one, the pay&hellip; mostly stays put.
        </p>
      </header>

      <section aria-label="Heads and tails" className="grid gap-4 md:grid-cols-2">
        <Face side="Heads" tone="gain" title={`The stock rose more than ${pctAbs(heads.lo)}`}
              value={signed(heads.median_change)} sub={`median change in CEO pay · ${Math.round((heads.share_up ?? 0) * 100)}% got a raise`} />
        <Face side="Tails" tone="loss" title={`The stock fell more than ${pctAbs(tails.hi)}`}
              value={signed(tails.median_change)} sub={`median change in CEO pay · ${Math.round((tails.share_up ?? 0) * 100)}% still got a raise`} />
      </section>

      <p className="text-[22px] leading-8 sm:text-[26px] sm:leading-9 font-bold tracking-[-0.01em] text-ink max-w-[34ch]">
        Year to year, the median CEO got a <span className="text-accent-ink">{pctAbs(a.overall.median_change, 1)}</span> raise.
        In a year shareholders lost more than {pctAbs(tails.hi)}, pay {(tails.median_change ?? 0) < 0 ? "slipped" : "still rose"}{" "}
        <span className="text-loss-ink">{pctAbs(tails.median_change, 1)}</span>, and {Math.round((tails.share_up ?? 0) * 100)}% got a raise anyway.
      </p>

      {raises.length > 0 && (
        <section aria-labelledby="raises" className="space-y-5">
          <div>
            <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-accent-ink">Raised anyway</div>
            <h2 id="raises" className="mt-1 text-[28px] leading-8 sm:text-[32px] sm:leading-[36px] font-extrabold tracking-[-0.02em] text-ink">
              Biggest raises in a year the stock fell {pctAbs(DROP)} or more
            </h2>
            <p className="mt-1 text-[14px] leading-5 text-ink-2 max-w-[70ch]">
              The same person was CEO for both full years. Pay is the Summary Compensation Table total the company reported;
              the stock is its own total shareholder return for that fiscal year. Most big jumps are a new stock grant,
              counted in full in the year it&apos;s made.
            </p>
          </div>
          <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {raises.map((r, i) => {
              const { name, ticker } = companyLabel(r);
              return (
                <li key={`${r.cik}-${r.fiscal_year}`} className="min-w-0 rounded-[14px] border border-line bg-surface px-5 py-4 shadow-card">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">
                        <span className="text-accent-ink font-bold mr-1.5">#{i + 1}</span>{ticker ?? "—"} · FY{r.fiscal_year}
                      </div>
                      <div className="mt-1 flex items-center gap-2 min-w-0">
                        <Logo cik={r.cik} size={26} />
                        <Link href={`/case/${r.cik}`} className="text-[16px] leading-6 font-semibold text-ink truncate hover:text-accent-ink">{name}</Link>
                      </div>
                      <div className="text-[12px] leading-4 text-ink-3 truncate">CEO: {r.peo_name}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[24px] leading-[28px] font-extrabold text-accent-ink num">+{compactMoney(r.sct - r.sct_prev)}</div>
                      <div className="text-[11px] leading-4 text-ink-3">raise</div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-[13px] leading-5">
                    <span><span className="text-ink-3">Stock that year </span><span className="num font-bold text-loss-ink">{signed(r.ret)}</span></span>
                    <span className="num text-ink-2 whitespace-nowrap">{compactMoney(r.sct_prev)} → <span className="text-ink font-semibold">{compactMoney(r.sct)}</span></span>
                  </div>
                  {r.doc_url && (
                    <a href={r.doc_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] text-ink-3 underline underline-offset-2 hover:text-ink-2">proxy</a>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <p className="text-[12px] leading-4 text-ink-3 max-w-[80ch]">
        {a.sample.pairs.toLocaleString("en-US")} CEO year-pairs, FY{a.sample.first_year - 1}–FY{a.sample.last_year}. Reported
        pay values stock awards when granted, often early in the year, so part of a year&apos;s pay is set before its return
        is known; the pattern is much the same measured against the year before. A new CEO&apos;s first year, pay under
        $100K, and companies whose tables show scale errors are left out. The raises list covers companies with a public
        float of at least $500M. These are facts about pay and stock, not about what any one person caused.{" "}
        <Link href="/about" className="underline underline-offset-2 hover:text-ink-2">How we know</Link>
      </p>
    </div>
  );
}
