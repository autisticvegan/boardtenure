"use client";

import { scaleUtc } from "d3-scale";
import { utcFormat } from "d3-time-format";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fmtDate, tenureLength, type Precision } from "@/lib/format";

export type TimelineRow = {
  key: string;
  href: string;
  name: string;
  status: "current" | "former";
  start_date: string | null;
  start_precision: Precision;
  end_date: string | null;
  end_precision: Precision | null;
  tag: string | null; // e.g. "Chair", "CEO"
};

const ROW = 28;
const LABEL_W = 188;
const t = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();

function windowEnd(iso: string, p: Precision | null): string {
  const [y, m] = iso.split("-").map(Number);
  if (p === "year") return `${y}-12-31`;
  if (p === "month") return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return iso;
}

export function BoardTimeline({ rows, ipoDate, asOf }: { rows: TimelineRow[]; ipoDate: string | null; asOf: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, "");

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const placed = rows.filter((r) => r.start_date);
  const unplaced = rows.filter((r) => !r.start_date);
  const labelW = width < 560 ? 120 : LABEL_W;
  const innerW = Math.max(0, width - labelW - 16);

  const { x, ticks, clipStart } = useMemo(() => {
    const starts = placed.map((r) => t(r.start_date!));
    const minStart = Math.min(...starts, ipoDate ? t(ipoDate) : t(asOf));
    // Keep the listed era readable: start at most ~3 years before listing and mark earlier starts.
    const floor = ipoDate ? t(ipoDate) - 3 * 365.25 * 86_400_000 : minStart;
    const d0 = Math.max(minStart, floor);
    const x = scaleUtc().domain([d0, t(asOf)]).range([0, innerW]);
    return { x, ticks: x.ticks(width < 560 ? 4 : 8), clipStart: d0 };
  }, [placed, ipoDate, asOf, innerW, width]);

  const height = placed.length * ROW + 30;
  const h = hover != null ? placed[hover] : null;

  return (
    <div ref={wrap} className="relative">
      {width > 0 && (
        <svg width={width} height={height} className="block" role="img" aria-label="Board membership timeline">
          <defs>
            <linearGradient id={`fade-cur-${gid}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0.85" />
            </linearGradient>
            <linearGradient id={`fade-old-${gid}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="var(--ink-3)" stopOpacity="0" />
              <stop offset="1" stopColor="var(--ink-3)" stopOpacity="0.55" />
            </linearGradient>
          </defs>
          <g transform={`translate(${labelW},0)`}>
            {ticks.map((d) => (
              <g key={d.getTime()} transform={`translate(${x(d)},0)`}>
                <line y1={0} y2={height - 22} stroke="var(--line)" />
                <text y={height - 6} textAnchor="middle" fontSize={11} fill="var(--ink-3)" className="num">
                  {utcFormat("%Y")(d)}
                </text>
              </g>
            ))}
            {ipoDate && t(ipoDate) >= clipStart && (
              <g transform={`translate(${x(t(ipoDate))},0)`}>
                <line y1={0} y2={height - 22} stroke="var(--ink-3)" strokeDasharray="0" strokeWidth={1} />
              </g>
            )}
          </g>
          {placed.map((r, i) => {
            const y0 = i * ROW + 4;
            const s = Math.max(t(r.start_date!), clipStart);
            const sureFrom = Math.max(t(windowEnd(r.start_date!, r.start_precision)), clipStart);
            const e = r.end_date ? t(r.end_date) : t(asOf);
            const cur = r.status === "current";
            const x0 = x(s);
            const xSure = Math.min(x(sureFrom), x(e));
            const x1 = Math.max(x(e), x0 + 2);
            const clipped = t(r.start_date!) < clipStart;
            const offChart = e < clipStart; // whole seat precedes the visible range
            return (
              <g
                key={r.key}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                className="cursor-pointer"
              >
                <rect x={0} y={y0 - 2} width={width} height={ROW} fill={hover === i ? "var(--surface-2)" : "transparent"} />
                <foreignObject x={0} y={y0} width={labelW - 8} height={ROW - 4}>
                  <Link href={r.href} className="flex items-center gap-1.5 h-full text-[12px] leading-none pr-1 min-w-0 outline-none focus-visible:underline">
                    <span className={`truncate ${cur ? "text-ink" : "text-ink-2"}`}>{r.name}</span>
                    {r.tag && <span className="shrink-0 text-[10px] text-ink-3 uppercase tracking-wide">{r.tag}</span>}
                  </Link>
                </foreignObject>
                <g transform={`translate(${labelW},0)`}>
                  {offChart && (
                    <text x={4} y={y0 + ROW / 2 - 2} fontSize={11} fill="var(--ink-3)" dominantBaseline="middle">
                      ‹ {r.start_date!.slice(0, 4)}–{(r.end_date ?? "").slice(0, 4)}, before listing
                    </text>
                  )}
                  {!offChart && xSure > x0 && (
                    <rect x={x0} y={y0 + 6} width={xSure - x0} height={ROW - 16}
                          fill={`url(#${cur ? "fade-cur" : "fade-old"}-${gid})`} />
                  )}
                  {!offChart && <rect
                    x={Math.max(x0, xSure)}
                    y={y0 + 6}
                    width={Math.max(2, x1 - Math.max(x0, xSure))}
                    height={ROW - 16}
                    rx={3}
                    fill={cur ? "var(--accent)" : "var(--ink-3)"}
                    opacity={cur ? 0.85 : 0.55}
                  />}
                  {clipped && !offChart && (
                    <text x={x0 + 4} y={y0 + ROW / 2 + 1} fontSize={10} fill="var(--surface)" dominantBaseline="middle">
                      ‹ {r.start_date!.slice(0, 4)}
                    </text>
                  )}
                </g>
              </g>
            );
          })}
        </svg>
      )}
      {width === 0 && <div className="skeleton" style={{ height }} />}
      {h && width > 0 && (
        <div
          className="absolute pointer-events-none z-10 rounded-md border border-line bg-surface shadow-card px-3 py-2 text-[12px]"
          style={{ top: (hover ?? 0) * ROW + ROW + 6, left: Math.min(width - 220, labelW + 8) }}
        >
          <div className="font-medium text-ink">{h.name}</div>
          <div className="text-ink-2 num">
            {fmtDate(h.start_date, h.start_precision)} – {h.end_date ? fmtDate(h.end_date, h.end_precision ?? "day") : "present"}
          </div>
          <div className="text-ink-3">{tenureLength(h.start_date, h.end_date, h.start_precision)} · {h.status === "current" ? "Current" : "Former"}</div>
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[12px] text-ink-3">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-accent opacity-85" />Current</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm bg-ink-3 opacity-55" />Former</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 h-2 rounded-sm" style={{ background: "linear-gradient(90deg, transparent, var(--accent))" }} />Start known only to month/year</span>
        {ipoDate && <span className="inline-flex items-center gap-1.5"><span className="w-px h-3 bg-ink-3" />IPO {fmtDate(ipoDate)}</span>}
      </div>
      {unplaced.length > 0 && (
        <p className="mt-2 text-[12px] text-ink-3">
          Start date not yet established: {unplaced.map((r) => r.name).join(", ")}.
        </p>
      )}
    </div>
  );
}
