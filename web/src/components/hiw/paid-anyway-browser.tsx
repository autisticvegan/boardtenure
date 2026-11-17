"use client";

import { useMemo, useState } from "react";
import { CaseCard, companyLabel } from "./case-card";
import type { ScreenCase } from "@/lib/queries-hiw";

type SortMode = "pay" | "wipeout" | "peers";

const SORTS: { key: SortMode; label: string }[] = [
  { key: "pay", label: "Most CEO pay" },
  { key: "wipeout", label: "Deepest wipeout ($100 → lowest)" },
  { key: "peers", label: "Widest lag vs peers" },
];

export function PaidAnywayBrowser({ cases }: { cases: ScreenCase[] }) {
  const [sort, setSort] = useState<SortMode>("pay");
  const [severeOnly, setSevereOnly] = useState(false);
  const [q, setQ] = useState("");

  // Preserve the original #1..#N pay rank on each card even when re-sorted or filtered.
  const payRank = useMemo(() => new Map(cases.map((c, i) => [c.cik, i + 1])), [cases]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = cases.filter((c) => {
      if (severeOnly && c.tsr_value_of_100 > 20) return false;
      if (!needle) return true;
      const { name, ticker } = companyLabel(c);
      return (
        name.toLowerCase().includes(needle)
        || (ticker ?? "").toLowerCase().includes(needle)
        || c.ceos.some((n) => n.toLowerCase().includes(needle))
      );
    });
    return [...filtered].sort((a, b) => {
      if (sort === "wipeout") return a.tsr_value_of_100 - b.tsr_value_of_100;
      if (sort === "peers") {
        const ga = (a.peer_tsr_value_of_100 ?? a.tsr_value_of_100) - a.tsr_value_of_100;
        const gb = (b.peer_tsr_value_of_100 ?? b.tsr_value_of_100) - b.tsr_value_of_100;
        return gb - ga;
      }
      return (b.peo_sct_sum ?? 0) - (a.peo_sct_sum ?? 0);
    });
  }, [cases, sort, severeOnly, q]);

  const severeCount = useMemo(() => cases.filter((c) => c.tsr_value_of_100 <= 20).length, [cases]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sort cases">
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
          {severeCount > 0 && (
            <button type="button" onClick={() => setSevereOnly((v) => !v)}
                    aria-pressed={severeOnly}
                    className={`min-h-10 rounded-full px-4 text-[13px] font-semibold border transition ${
                      severeOnly
                        ? "bg-loss text-ink border-loss"
                        : "border-loss/40 text-loss-ink hover:border-loss"
                    }`}>
              80%+ wiped out ({severeCount})
            </button>
          )}
        </div>
        <div className="w-full sm:w-[240px]">
          <label htmlFor="paid-filter" className="sr-only">Filter by company, ticker, or CEO</label>
          <input id="paid-filter" type="search" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Filter company or CEO…" autoComplete="off"
                 className="w-full min-h-10 rounded-full border border-line-strong bg-surface px-4 text-[13px] text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent" />
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-line-strong bg-surface px-5 py-8 text-center text-[14px] text-ink-2">
          No cases match that filter.{" "}
          <button type="button" onClick={() => { setQ(""); setSevereOnly(false); }}
                  className="text-accent-ink font-semibold underline underline-offset-2">
            Reset
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((c) => <CaseCard key={c.cik} c={c} rank={payRank.get(c.cik)} />)}
        </div>
      )}
    </div>
  );
}
