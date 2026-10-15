"use client";

import Link from "next/link";
import { Logo } from "@/components/logo";
import { useState } from "react";

export type FlipCase = { cik: number; name: string; ticker: string | null; ceo: string | null; pay: string; tsr: string; span: string };

/** "Flip the coin": deal a random real case. Heads is the CEO's pay; tails is your $100. */
export function FlipGame({ cases }: { cases: FlipCase[] }) {
  const [pick, setPick] = useState<FlipCase | null>(null);
  const [flips, setFlips] = useState(0);
  const flip = () => {
    if (cases.length === 0) return;
    let next = cases[Math.floor(Math.random() * cases.length)];
    if (cases.length > 1) while (next === pick) next = cases[Math.floor(Math.random() * cases.length)];
    setPick(next);
    setFlips((n) => n + 1);
  };
  return (
    <div className="rounded-[18px] border border-line bg-surface shadow-card p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[22px] leading-7 font-extrabold text-ink">Flip the coin</h2>
          <p className="mt-1 text-[13px] leading-5 text-ink-2">Deal a real case from a company&apos;s own proxy. See how it lands.</p>
        </div>
        <button type="button" onClick={flip}
                className="min-h-11 rounded-full bg-accent px-6 text-[15px] font-extrabold text-ink-on-mark hover:brightness-110 active:scale-95 transition">
          {flips === 0 ? "Flip it" : "Flip again"}
        </button>
      </div>
      <div aria-live="polite" className="mt-5">
        {pick && (
          <div key={flips} className="hiw-pop grid gap-3 sm:grid-cols-2">
            <div className="rounded-[14px] bg-accent-wash border border-accent/40 px-5 py-4">
              <div className="text-[11px] leading-[14px] uppercase tracking-[0.12em] font-bold text-accent-ink">Heads · the CEO</div>
              <div className="mt-1 text-[36px] leading-[40px] font-extrabold text-accent-ink num">{pick.pay}</div>
              <div className="text-[12px] leading-4 text-ink-2">{pick.ceo ?? "CEO"} · {pick.span}</div>
            </div>
            <div className="rounded-[14px] bg-[rgba(217,89,38,0.12)] border border-loss/40 px-5 py-4">
              <div className="text-[11px] leading-[14px] uppercase tracking-[0.12em] font-bold text-loss-ink">Tails · you</div>
              <div className="mt-1 text-[36px] leading-[40px] font-extrabold text-loss-ink num">$100 → {pick.tsr}</div>
              <div className="mt-1 flex items-center gap-2 text-[12px] leading-4 text-ink-2">
                <Logo cik={pick.cik} size={22} />{pick.name}{pick.ticker && ` (${pick.ticker})`}, same years
              </div>
            </div>
            <Link href={`/case/${pick.cik}`} className="sm:col-span-2 text-[13px] font-semibold text-accent-ink hover:underline underline-offset-2">
              See the numbers and the filing →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
