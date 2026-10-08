"use client";

// "The stock itself" (rankings-ui.md §4.3 row 7): the company's own share-price chart, demoted into a
// closed <details> that mounts ReturnChart only on first open. Context, never a ranking input.
import { useId, useState } from "react";
import { ReturnChart, type Marker } from "@/components/return-chart";
import type { ChartPoint } from "@/lib/series";

export type MarketCap = { value: string; approx: boolean; close: string; note: string };

export function StockDetails({ symbol, benchLabel, since, points, markers, baseCaption, marketCap }: {
  symbol: string;
  benchLabel: string | null;
  since: string | null; // formatted first chart date
  points: ChartPoint[];
  markers: Marker[];
  baseCaption?: string;
  marketCap: MarketCap | null;
}) {
  const [mounted, setMounted] = useState(false);
  const headId = useId();
  // The heading sits outside <summary> (whose children are presentational), so it stays in the outline.
  return (
    <section aria-labelledby={headId}>
      <h2 id={headId} className="sr-only">The stock itself</h2>
      <details
        className="group rounded-[14px] border border-line bg-surface shadow-card"
        onToggle={(e) => { if (e.currentTarget.open) setMounted(true); }}
      >
        <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center gap-3 px-4 sm:px-5 py-3 min-h-11 rounded-[14px] hover:bg-surface-2 transition-colors">
          <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" className="shrink-0 text-ink-3 transition-transform group-open:rotate-90">
            <path d="M4 2.5 L8 6 L4 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[15px] leading-5 font-[650] text-ink">
            The stock itself: {symbol} vs S&amp;P 500{since ? ` since ${since}` : ""}
          </span>
        </summary>
        <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 mb-3 text-[12px] leading-4">
            <p className="text-ink-2">Context only. Standings use each director&apos;s own window.</p>
            {marketCap && (
              <p className="text-ink-3">
                Market cap {marketCap.approx ? "≈ " : ""}<span className="text-ink-2 num">{marketCap.value}</span> at the {marketCap.close} close
                <span className="block sm:inline sm:before:content-['_·_']">{marketCap.note}</span>
              </p>
            )}
          </div>
          {points.length < 2 ? (
            <p className="py-6 text-[13px] leading-5 text-ink-3">No price history stored for {symbol} yet.</p>
          ) : mounted ? (
            <ReturnChart points={points} stockLabel={symbol} benchLabel={benchLabel} markers={markers} height={220} baseCaption={baseCaption} />
          ) : (
            <div className="skeleton" style={{ height: 220 }} />
          )}
        </div>
      </details>
    </section>
  );
}
