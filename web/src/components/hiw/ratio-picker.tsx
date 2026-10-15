"use client";

// Pick a company: its CEO pay ratio, the moment the CEO "caught up" with the median worker's year,
// and a live meter of what each has earned since the page opened (if pay arrived evenly).
import { useEffect, useMemo, useState } from "react";
import { Logo } from "@/components/logo";
import { caughtUpAt, ratioLabel, startedIn } from "@/lib/ratio";

export type RatioRow = {
  cik: number; name: string; ticker: string | null; year: number | null; ratio: number; ceo: number; median: number; url: string;
};

const SECONDS_PER_YEAR = 365 * 24 * 3600;
const usd = (x: number, digits = 2) =>
  `$${x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const compact = (x: number) =>
  x >= 1e9 ? `$${(x / 1e9).toFixed(1)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${Math.round(x).toLocaleString("en-US")}`;

export function RatioPicker({ rows }: { rows: RatioRow[] }) {
  const [q, setQ] = useState("");
  const [cik, setCik] = useState(rows[0]?.cik);
  const [secs, setSecs] = useState(0);
  const pick = rows.find((r) => r.cik === cik) ?? rows[0];

  useEffect(() => {
    const t0 = performance.now();
    const id = window.setInterval(() => setSecs((performance.now() - t0) / 1000), 100);
    return () => window.clearInterval(id);
  }, [cik]);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return rows.filter((r) => r.name.toLowerCase().includes(s) || (r.ticker ?? "").toLowerCase().startsWith(s)).slice(0, 8);
  }, [q, rows]);

  if (!pick) return null;
  return (
    <section aria-labelledby="pick" className="rounded-[18px] border border-line bg-surface px-5 py-5 sm:px-6 shadow-card">
      <h2 id="pick" className="text-[20px] leading-7 font-extrabold text-ink">Pick a company</h2>
      <div className="relative mt-3 max-w-[420px]">
        <label htmlFor="ratio-q" className="sr-only">Company name or ticker</label>
        <input id="ratio-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a company or ticker…" autoComplete="off"
               className="w-full min-h-11 rounded-full border border-line-strong bg-bg px-4 text-[14px] text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent" />
        {matches.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-[12px] border border-line bg-surface-2 shadow-card">
            {matches.map((m) => (
              <li key={m.cik}>
                <button type="button" onClick={() => { setCik(m.cik); setQ(""); }}
                        className="flex w-full min-h-11 items-center gap-2 px-3 text-left text-[13px] text-ink hover:bg-surface-3">
                  <Logo cik={m.cik} size={22} /><span className="truncate">{m.name}</span>
                  {m.ticker && <span className="ml-auto font-mono text-ink-3">{m.ticker}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div key={pick.cik} className="hiw-pop mt-5 grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Logo cik={pick.cik} size={36} />
            <div className="min-w-0">
              <div className="text-[17px] leading-6 font-bold text-ink truncate">{pick.name}</div>
              <div className="text-[12px] leading-4 text-ink-3">{pick.ticker ?? "—"}{pick.year && ` · FY${pick.year}`}</div>
            </div>
          </div>
          <div className="mt-4 text-[56px] leading-[56px] font-black tracking-[-0.04em] text-accent-ink num hiw-greedy w-fit origin-left">
            {ratioLabel(pick.ratio)}
          </div>
          <p className="mt-2 text-[14px] leading-5 text-ink-2">
            The CEO made <strong className="text-ink">{compact(pick.ceo)}</strong>; the median employee made{" "}
            <strong className="text-ink">{compact(pick.median)}</strong>.
          </p>
          <ul className="mt-3 space-y-1.5 text-[14px] leading-5 text-ink-2">
            <li>⏰ The CEO had earned the median worker&apos;s whole year by <strong className="text-ink">{caughtUpAt(pick.ratio)}</strong>.</li>
            <li>⏳ To earn one CEO year, the median worker would have had to start in <strong className="text-ink">{startedIn(pick.ratio)}</strong>.</li>
          </ul>
          <a href={pick.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[12px] text-ink-3 underline underline-offset-2 hover:text-ink-2">
            the proxy&apos;s pay-ratio disclosure
          </a>
        </div>
        <div className="rounded-[14px] border border-line bg-bg px-4 py-4" aria-live="off">
          <div className="text-[11px] leading-[14px] uppercase tracking-[0.12em] font-bold text-ink-3">Since you picked it</div>
          <div className="mt-3 text-[12px] leading-4 text-ink-3">The CEO</div>
          <div className="text-[30px] leading-[34px] font-black text-accent-ink num">{usd((pick.ceo / SECONDS_PER_YEAR) * secs)}</div>
          <div className="mt-3 text-[12px] leading-4 text-ink-3">The median worker</div>
          <div className="text-[30px] leading-[34px] font-black text-ink num">{usd((pick.median / SECONDS_PER_YEAR) * secs, 4)}</div>
          <div className="mt-3 text-[11px] leading-4 text-ink-3">If a year&apos;s reported pay arrived evenly, every second of the year.</div>
        </div>
      </div>
    </section>
  );
}
