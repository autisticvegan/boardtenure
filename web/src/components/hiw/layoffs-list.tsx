"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Logo } from "@/components/logo";
import { compactMoney } from "@/lib/format";
import type { HiwCase, HiwFigure } from "@/lib/queries-hiw";

const figOf = (c: HiwCase, key: string): HiwFigure | undefined => c.figures.find((f) => f.key === key);
const countFmt = (n: number) => Math.round(n).toLocaleString("en-US");

type SortMode = "cuts" | "ceo" | "buybacks" | "perJob";

const SORTS: { key: SortMode; label: string }[] = [
  { key: "cuts", label: "Most jobs cut" },
  { key: "ceo", label: "Highest CEO pay" },
  { key: "buybacks", label: "Biggest buybacks" },
  { key: "perJob", label: "Most buybacks per job cut" },
];

export function LayoffsList({ cases }: { cases: HiwCase[] }) {
  const [sort, setSort] = useState<SortMode>("cuts");

  const ranked = useMemo(() => {
    const score = (c: HiwCase) => {
      const cut = figOf(c, "jobs_cut")?.value ?? 0;
      const pay = figOf(c, "ceo_pay")?.value ?? 0;
      const bb = figOf(c, "buybacks")?.value ?? 0;
      if (sort === "ceo") return pay;
      if (sort === "buybacks") return bb;
      if (sort === "perJob") return cut > 0 && bb > 0 ? bb / cut : -1;
      return cut;
    };
    return [...cases].sort((a, b) => score(b) - score(a));
  }, [cases, sort]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Order announcements">
        {SORTS.map((s) => (
          <button key={s.key} type="button" onClick={() => setSort(s.key)}
                  aria-pressed={sort === s.key}
                  className={`min-h-10 rounded-full px-4 text-[13px] font-semibold border transition ${
                    sort === s.key
                      ? "bg-accent text-ink-on-mark border-accent"
                      : "border-line-strong text-ink-2 hover:text-ink"
                  }`}>
            {s.label}
          </button>
        ))}
      </div>
      <ol className="space-y-4">
        {ranked.map((c) => <Row key={c.id} c={c} />)}
      </ol>
    </div>
  );
}

function Row({ c }: { c: HiwCase }) {
  const cut = figOf(c, "jobs_cut"), pct = figOf(c, "pct_workforce"), pay = figOf(c, "ceo_pay"), prior = figOf(c, "ceo_pay_prior");
  const bb = figOf(c, "buybacks"), cost = figOf(c, "restructuring_cost");
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
            {cut && <span className="text-[34px] leading-[38px] font-black text-loss-ink num">{countFmt(cut.value)}</span>}
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
