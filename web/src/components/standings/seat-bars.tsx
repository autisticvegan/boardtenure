"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { fmtDate, pct } from "@/lib/format";
import { perYear, years } from "@/lib/standings";
import { Chip } from "./primitives";

export type SeatBarRow = {
  key: string;
  href: string;
  label: string; // company name
  symbol: string;
  window: string; // "Jul 2010 – present"
  sub: string; // "Jul 2010 – present · 16.2 yrs"
  excess: number; // annualized excess vs the S&P 500
  total: number | null;
  bench: number | null;
  days: number | null;
  mdd: number | null;
  mddPeak: string | null;
  mddTrough: string | null;
  exec: boolean;
  ipo: boolean;
  hollow: boolean; // exec seat outside the active (Non-exec) score
};

export type UnscoredBarRow = { key: string; href: string; label: string; symbol: string; sub: string; reason: string; range: string | null };

/** "Jan 3 → Dec 28, 2022" within one year, else "Dec 10, 1999 → Sep 28, 2001". */
function dropRange(peak: string | null, trough: string | null): string | null {
  if (!peak || !trough) return null;
  if (peak.slice(0, 4) === trough.slice(0, 4)) return `${fmtDate(peak).replace(/, \d{4}$/, "")} → ${fmtDate(trough)}`;
  return `${fmtDate(peak)} → ${fmtDate(trough)}`;
}

const COLS = "grid-cols-[8rem_minmax(0,1fr)] sm:grid-cols-[14rem_minmax(0,1fr)]";
const EXEC_CHIP = "Exec seat · not in this score";

/**
 * Seat by seat: annualized excess per seat as a diverging bar from one zero line, on the page's
 * shared domain. Rows are links; hover or focus shows the details (also in the career table).
 */
export function SeatBars({ rows, unscored = [], domain }: { rows: SeatBarRow[]; unscored?: UnscoredBarRow[]; domain: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const tipId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const edge = `${Math.round(domain * 100)}%`;

  return (
    <div className="space-y-4">
      {rows.length > 0 && (
        <div role="group" aria-label={`${rows.length} scored seat${rows.length === 1 ? "" : "s"}: stock vs S&P 500 per year during each seat, on one scale from −${edge} to +${edge} a year.`}>
          <div className="space-y-1">
            {rows.map((r, i) => {
              const frac = Math.min(1, Math.abs(r.excess) / domain) * 50; // % of track width
              const over = Math.abs(r.excess) > domain;
              const neg = r.excess < 0;
              const inside = frac > 38;
              const isOpen = open === r.key;
              const fill = neg ? "var(--loss)" : "var(--gain)";
              const drop = dropRange(r.mddPeak, r.mddTrough);
              return (
                <div
                  key={r.key}
                  className={`relative grid ${COLS} gap-x-3`}
                  onPointerEnter={() => setOpen(r.key)}
                  onPointerLeave={() => setOpen((k) => (k === r.key ? null : k))}
                >
                  <Link
                    href={r.href}
                    aria-describedby={isOpen ? `${tipId}-${i}` : undefined}
                    onFocus={() => setOpen(r.key)}
                    onBlur={() => setOpen((k) => (k === r.key ? null : k))}
                    className={`col-start-1 col-span-2 row-start-1 grid grid-cols-subgrid items-center rounded-md px-2 py-1.5 transition-colors ${isOpen ? "bg-surface-2" : ""}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] leading-5 text-ink">
                        {r.label} <span className="font-mono text-[11px] text-ink-3">{r.symbol}</span>
                      </span>
                      <span className="block truncate text-[11px] leading-[14px] text-ink-3 num">{r.sub}</span>
                      {r.hollow && <span className="hidden sm:inline-flex mt-1"><Chip kind="exec" label={EXEC_CHIP} /></span>}
                    </span>
                    <span className="relative h-7">
                      <span className="absolute inset-y-0 left-1/2 w-px bg-zero" aria-hidden />
                      <span
                        aria-hidden
                        className={`absolute top-1/2 -translate-y-1/2 h-5 ${i < 10 ? "anim-grow" : ""}`}
                        style={{
                          left: neg ? `${50 - frac}%` : "50%",
                          width: `${Math.max(frac, 0.4)}%`,
                          background: r.hollow ? "transparent" : fill,
                          boxShadow: r.hollow ? `inset 0 0 0 2px ${fill}` : undefined,
                          borderRadius: over && !r.hollow ? 0 : neg ? "4px 0 0 4px" : "0 4px 4px 0",
                          clipPath: over && !r.hollow
                            ? neg ? "polygon(6px 0, 100% 0, 100% 100%, 6px 100%, 0 50%)"
                                  : "polygon(0 0, calc(100% - 6px) 0, 100% 50%, calc(100% - 6px) 100%, 0 100%)"
                            : undefined,
                          transformOrigin: neg ? "right center" : "left center",
                          animationDelay: i < 10 ? `${i * 15}ms` : undefined,
                        }}
                      />
                      <span
                        className={`absolute top-1/2 -translate-y-1/2 text-[12px] leading-4 num font-semibold whitespace-nowrap ${
                          inside ? `px-2 ${r.hollow ? "text-ink" : "text-ink-on-mark"}` : "text-ink"
                        }`}
                        style={inside
                          ? (neg ? { left: `${50 - frac}%` } : { right: `${50 - frac}%` })
                          : (neg ? { right: `${50 + frac + 1}%` } : { left: `${50 + frac + 1}%` })}
                      >
                        {perYear(r.excess)}
                      </span>
                    </span>
                  </Link>
                  {r.hollow && <span className="sm:hidden col-span-2 px-2 pb-1"><Chip kind="exec" label={EXEC_CHIP} /></span>}
                  {isOpen && (
                    <div className="col-start-2 row-start-1 relative pointer-events-none">
                      <div
                        id={`${tipId}-${i}`}
                        role="tooltip"
                        className="anim-tip pointer-events-auto absolute z-30 top-full left-1/2 -translate-x-1/2 mt-1 w-max max-w-[300px] rounded-lg border border-line-strong bg-surface-3 px-3 py-2 text-[12px] leading-4 text-ink-2 shadow-card"
                      >
                        <span className="block font-semibold text-ink">
                          {r.symbol} · {r.window}{r.days != null ? ` · ${years(r.days)} yrs` : ""}
                        </span>
                        <span className="block num">Stock {pct(r.total)} · S&amp;P 500 {pct(r.bench)}</span>
                        <span className="block num">Per year vs S&amp;P {pct(r.excess)}</span>
                        {r.mdd != null && (
                          <span className="block num">Worst drop {pct(r.mdd)}{drop ? ` (${drop})` : ""}</span>
                        )}
                        {r.exec && <span className="block">Exec seat{r.hollow ? " · not in this score" : ""}</span>}
                        {r.ipo && <span className="block">From IPO</span>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className={`grid ${COLS} gap-x-3 px-2 mt-1 text-[11px] leading-[14px] text-ink-3`} aria-hidden>
            <span />
            <span className="relative">
              <span className="flex justify-between num"><span>−{edge}</span><span>0</span><span>+{edge}</span></span>
              <span className="mt-0.5 flex justify-between"><span>Trailed the S&amp;P</span><span>Beat the S&amp;P</span></span>
            </span>
          </div>
        </div>
      )}

      {unscored.length > 0 && (
        <ul className="space-y-1.5" aria-label="Seats not scored">
          {unscored.map((u) => (
            <li key={u.key}>
              <Link
                href={u.href}
                className={`grid ${COLS} items-center gap-x-3 rounded-md border border-dashed border-line-strong px-2 py-1.5 transition-colors hover:bg-surface-2`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] leading-5 text-ink">
                    {u.label} <span className="font-mono text-[11px] text-ink-3">{u.symbol}</span>
                  </span>
                  <span className="block truncate text-[11px] leading-[14px] text-ink-3 num">{u.sub}</span>
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Chip kind="reason" label={u.reason} />
                  {u.range && <span className="text-[12px] text-ink-2 num">{u.range}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
