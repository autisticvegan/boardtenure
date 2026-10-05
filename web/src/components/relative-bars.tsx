"use client";

import Link from "next/link";
import { useState } from "react";
import { pct, pp } from "@/lib/format";

export type RelBar = { key: string; href: string; label: string; sub: string; rel: number; total: number; bench: number };

/**
 * One row per measured tenure: relative return vs the benchmark as a bar from a
 * shared zero line. Direction carries the sign; values are labeled at the bar tips.
 */
export function RelativeBars({ rows, benchName }: { rows: RelBar[]; benchName: string }) {
  const [hover, setHover] = useState<string | null>(null);
  if (rows.length === 0) return null;
  const maxAbs = Math.max(0.05, ...rows.map((r) => Math.abs(r.rel)));
  return (
    <div className="space-y-1">
      {rows.map((r) => {
        const w = (Math.abs(r.rel) / maxAbs) * 50;
        const neg = r.rel < 0;
        return (
          <Link
            key={r.key}
            href={r.href}
            onPointerEnter={() => setHover(r.key)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(r.key)}
            onBlur={() => setHover(null)}
            className={`grid grid-cols-[minmax(0,10rem)_1fr] sm:grid-cols-[minmax(0,14rem)_1fr] items-center gap-3 rounded-md px-2 py-1.5 transition-colors ${hover === r.key ? "bg-surface-2" : ""}`}
          >
            <span className="min-w-0">
              <span className="block truncate text-[13px] text-ink">{r.label}</span>
              <span className="block truncate text-[11px] text-ink-3">{r.sub}</span>
            </span>
            <span className="relative h-7">
              <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" aria-hidden />
              <span
                className="absolute top-1/2 -translate-y-1/2 h-3 bg-accent"
                style={{
                  left: neg ? `${50 - w}%` : "50%",
                  width: `${Math.max(w, 0.4)}%`,
                  borderRadius: neg ? "4px 0 0 4px" : "0 4px 4px 0",
                  opacity: hover && hover !== r.key ? 0.5 : 0.9,
                }}
              />
              <span
                className="absolute top-1/2 -translate-y-1/2 text-[12px] num font-medium text-ink whitespace-nowrap"
                style={neg ? { right: `${50 + w + 1}%` } : { left: `${50 + w + 1}%` }}
              >
                {pp(r.rel)}
              </span>
              {hover === r.key && (
                <span className="absolute z-10 top-full mt-1 left-1/2 -translate-x-1/2 rounded-md border border-line bg-surface shadow-card px-3 py-2 text-[12px] whitespace-nowrap">
                  <span className="block"><b className="num">{pct(r.total)}</b> <span className="text-ink-2">stock</span></span>
                  <span className="block"><b className="num">{pct(r.bench)}</b> <span className="text-ink-2">{benchName}</span></span>
                </span>
              )}
            </span>
          </Link>
        );
      })}
      <div className="grid grid-cols-[minmax(0,10rem)_1fr] sm:grid-cols-[minmax(0,14rem)_1fr] gap-3 px-2 text-[11px] text-ink-3">
        <span />
        <span className="flex justify-between"><span>Underperformed</span><span>Outperformed</span></span>
      </div>
    </div>
  );
}
