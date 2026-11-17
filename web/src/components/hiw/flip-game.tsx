"use client";

import Link from "next/link";
import { Logo } from "@/components/logo";
import { useState } from "react";

export type FlipCase = {
  cik: number;
  name: string;
  ticker: string | null;
  ceo: string | null;
  pay: string;
  payNum: number;
  tsr: string;
  tsrNum: number;
  span: string;
};

const compactUsd = (x: number) =>
  x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${Math.round(x).toLocaleString("en-US")}`;

/** "Flip the coin": deal a random real case. Heads is the CEO's pay; tails is your $100. */
export function FlipGame({ cases }: { cases: FlipCase[] }) {
  const [pick, setPick] = useState<FlipCase | null>(cases[0] ?? null);
  const [flips, setFlips] = useState(cases.length > 0 ? 1 : 0);
  const [sumPay, setSumPay] = useState(cases[0]?.payNum ?? 0);
  const [sumTsr, setSumTsr] = useState(cases[0]?.tsrNum ?? 0);
  const [copied, setCopied] = useState(false);

  const flip = () => {
    if (cases.length === 0) return;
    let next = cases[Math.floor(Math.random() * cases.length)];
    if (cases.length > 1) while (next === pick) next = cases[Math.floor(Math.random() * cases.length)];
    setPick(next);
    setFlips((n) => n + 1);
    setSumPay((s) => s + next.payNum);
    setSumTsr((s) => s + next.tsrNum);
    setCopied(false);
  };

  const copyReceipt = async () => {
    if (!pick) return;
    const lost = Math.max(0, Math.round(100 - pick.tsrNum));
    const line = `${pick.name}${pick.ticker ? ` (${pick.ticker})` : ""}, ${pick.span}: $100 of stock shrank to ${pick.tsr} (−${lost}%), while ${pick.ceo ?? "the CEO"} was reported paid ${pick.pay}.`;
    try {
      await navigator.clipboard.writeText(line);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const centsLost = pick ? Math.max(0, Math.round(100 - pick.tsrNum)) : 0;

  return (
    <div className="rounded-[18px] border border-line bg-surface shadow-card p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-accent-ink">Interactive · {cases.length} proxy tables in the deck</div>
          <h2 className="mt-0.5 text-[22px] leading-7 font-extrabold text-ink">Flip the rigged coin</h2>
          <p className="mt-1 text-[13px] leading-5 text-ink-2">
            Deal a real company from its own SEC proxy statement. Heads is what the CEO collected; tails is what $100 of stock became.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={flip}
                  className="min-h-11 rounded-full bg-accent px-6 text-[15px] font-extrabold text-ink-on-mark hover:brightness-110 active:scale-95 transition">
            Deal another 🪙
          </button>
        </div>
      </div>
      <div aria-live="polite" className="mt-5">
        {pick && (
          <div key={flips} className="hiw-pop space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[14px] bg-accent-wash border border-accent/40 px-5 py-4">
                <div className="text-[11px] leading-[14px] uppercase tracking-[0.12em] font-bold text-accent-ink">Heads · the CEO</div>
                <div className="mt-1 text-[36px] leading-[40px] font-extrabold text-accent-ink num">{pick.pay}</div>
                <div className="text-[12px] leading-4 text-ink-2">{pick.ceo ?? "CEO"} · {pick.span}</div>
              </div>
              <div className="rounded-[14px] bg-[rgba(217,89,38,0.12)] border border-loss/40 px-5 py-4">
                <div className="text-[11px] leading-[14px] uppercase tracking-[0.12em] font-bold text-loss-ink">Tails · shareholders</div>
                <div className="mt-1 text-[36px] leading-[40px] font-extrabold text-loss-ink num">$100 → {pick.tsr}</div>
                <div className="mt-1 flex items-center gap-2 text-[12px] leading-4 text-ink-2">
                  <Logo cik={pick.cik} size={22} />{pick.name}{pick.ticker && ` (${pick.ticker})`}, same years
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-[13px] leading-5">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-ink-2">
                  Shareholders lost <strong className="text-loss-ink num">{centsLost}¢</strong> on the dollar; reported CEO pay totaled <strong className="text-accent-ink num">{pick.pay}</strong>.
                </span>
                <Link href={`/case/${pick.cik}`} className="font-semibold text-accent-ink hover:underline underline-offset-2">
                  Open the filing →
                </Link>
                <button type="button" onClick={copyReceipt}
                        className="text-[12px] font-semibold text-ink-3 hover:text-ink underline underline-offset-2">
                  {copied ? "Copied ✓" : "Copy blurb"}
                </button>
              </div>
              {flips > 1 && (
                <span className="text-[12px] text-ink-3 num">
                  Your {flips} deals: CEOs <strong className="text-accent-ink">{compactUsd(sumPay)}</strong> · avg $100 → <strong className="text-loss-ink">${(sumTsr / flips).toFixed(2)}</strong>
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
