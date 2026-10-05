"use client";

import { bisector, extent } from "d3-array";
import { scaleLinear, scaleUtc } from "d3-scale";
import { line } from "d3-shape";
import { utcFormat } from "d3-time-format";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChartPoint } from "@/lib/series";
import { fmtDate, pct, pp } from "@/lib/format";

export type Marker = { d: string; label: string; kind: "join" | "leave" | "ipo" | "event" };

type Props = {
  points: ChartPoint[];
  stockLabel: string;
  benchLabel: string | null;
  band?: { from: string; to: string };
  markers?: Marker[];
  height?: number;
  /** Caption for the 0% line, e.g. "Rebased to 0% at the Mar 15, 2021 close". */
  baseCaption?: string;
};

const M = { top: 30, right: 104, bottom: 28, left: 52 };
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const byDate = bisector((p: { t: number }) => p.t).center;

export function ReturnChart({ points, stockLabel, benchLabel, band, markers = [], height = 320, baseCaption }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => points.map((p) => ({ ...p, t: toDate(p.d).getTime() })), [points]);
  const hasBench = benchLabel != null && data.some((p) => p.b != null);
  const narrow = width > 0 && width < 520;
  const margin = { ...M, right: narrow ? 12 : M.right, left: narrow ? 44 : M.left };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = height - margin.top - margin.bottom;

  const { x, y, stockPath, benchPath, xTicks, yTicks } = useMemo(() => {
    const [t0, t1] = extent(data, (p) => p.t) as [number, number];
    const vals = data.flatMap((p) => (hasBench && p.b != null ? [p.s, p.b] : [p.s]));
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals);
    const pad = (hi - lo) * 0.08 || 0.05;
    const x = scaleUtc().domain([t0 ?? 0, t1 ?? 1]).range([0, innerW]);
    // A total return can't fall below -100%; don't let padding or nice() push the axis there.
    const y = scaleLinear().domain([Math.max(-1, lo - pad), hi + pad]).nice(5).range([innerH, 0]);
    if (y.domain()[0] < -1) y.domain([-1, y.domain()[1]]);
    const mk = (get: (p: (typeof data)[number]) => number | null) =>
      line<(typeof data)[number]>()
        .defined((p) => get(p) != null)
        .x((p) => x(p.t))
        .y((p) => y(get(p) as number))(data) ?? "";
    const spanYears = ((t1 ?? 0) - (t0 ?? 0)) / (365.25 * 86_400_000);
    return {
      x,
      y,
      stockPath: mk((p) => p.s),
      benchPath: hasBench ? mk((p) => p.b) : "",
      xTicks: x.ticks(narrow ? 4 : spanYears > 2.5 ? 7 : 6).map((d) => ({
        t: d.getTime(),
        label: utcFormat(spanYears > 2.5 ? "%Y" : "%b %Y")(d),
      })),
      yTicks: y.ticks(5),
    };
  }, [data, hasBench, innerW, innerH, narrow]);

  if (data.length < 2) {
    return <div className="h-[200px] grid place-items-center text-ink-3 text-[13px]">Not enough price history to chart.</div>;
  }

  const last = data[data.length - 1];
  const h = hover != null ? data[hover] : null;

  // Direct end labels; when they would collide, spread them and draw short leaders.
  const ends = [{ key: "s", label: stockLabel, v: last.s, color: "var(--accent)" }];
  if (hasBench && last.b != null) ends.push({ key: "b", label: benchLabel!, v: last.b, color: "var(--bench)" });
  const endY = ends.map((e) => y(e.v));
  if (ends.length === 2 && Math.abs(endY[0] - endY[1]) < 30) {
    const mid = (endY[0] + endY[1]) / 2;
    const up = endY[0] <= endY[1] ? 0 : 1;
    endY[up] = mid - 15;
    endY[1 - up] = mid + 15;
  }

  const onMove = (clientX: number) => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect) return;
    const t = x.invert(clientX - rect.left - margin.left).getTime();
    setHover(byDate(data, t));
  };

  const bandX0 = band ? Math.max(0, x(toDate(band.from).getTime())) : 0;
  const bandX1 = band ? Math.min(innerW, x(toDate(band.to).getTime())) : 0;

  return (
    <figure className="m-0">
      <figcaption id={titleId} className="sr-only">
        Cumulative total return of {stockLabel}
        {hasBench ? ` and ${benchLabel}` : ""} from {fmtDate(data[0].d)} to {fmtDate(last.d)}.
      </figcaption>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 text-[12px] text-ink-2">
        <LegendKey color="var(--accent)" label={`${stockLabel} total return`} />
        {hasBench && <LegendKey color="var(--bench)" label={`${benchLabel} total return`} />}
        {band && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: "var(--band)", boxShadow: "inset 0 0 0 1px var(--line)" }} />Board tenure</span>}
        {baseCaption && <span className="text-ink-3 ml-auto">{baseCaption}</span>}
      </div>
      <div
        ref={wrap}
        className="relative select-none touch-pan-y outline-none rounded focus-visible:ring-4 focus-visible:ring-accent-wash"
        style={{ height }}
        tabIndex={0}
        role="img"
        aria-labelledby={titleId}
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            const step = e.shiftKey ? 20 : 1;
            setHover((i) => {
              const cur = i ?? (e.key === "ArrowRight" ? -1 : data.length);
              return Math.max(0, Math.min(data.length - 1, cur + (e.key === "ArrowRight" ? step : -step)));
            });
          } else if (e.key === "Escape") setHover(null);
        }}
        onBlur={() => setHover(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} className="block overflow-visible">
            <g transform={`translate(${margin.left},${margin.top})`}>
              {band && bandX1 > bandX0 && (
                <rect x={bandX0} y={0} width={bandX1 - bandX0} height={innerH} fill="var(--band)" />
              )}
              {yTicks.map((v) => (
                <g key={v} transform={`translate(0,${y(v)})`}>
                  <line x1={0} x2={innerW} stroke={v === 0 ? "var(--line-strong)" : "var(--line)"} strokeWidth={1} />
                  <text x={-10} dy="0.32em" textAnchor="end" className="num" fontSize={11} fill="var(--ink-3)">
                    {pct(v, 0)}
                  </text>
                </g>
              ))}
              {xTicks.map((tk) => (
                <text key={tk.t} x={x(tk.t)} y={innerH + 18} textAnchor="middle" fontSize={11} fill="var(--ink-3)" className="num">
                  {tk.label}
                </text>
              ))}
              {markers.map((m) => {
                const mx = x(toDate(m.d).getTime());
                if (mx < -1 || mx > innerW + 1) return null;
                const strong = m.kind === "join" || m.kind === "leave";
                return (
                  <g key={`${m.kind}-${m.d}`} transform={`translate(${mx},0)`}>
                    <line y1={-6} y2={innerH} stroke={strong ? "var(--ink-2)" : "var(--line-strong)"} strokeWidth={1} />
                    <text
                      y={-12}
                      textAnchor={mx > innerW - 60 ? "end" : mx < 60 ? "start" : "middle"}
                      fontSize={11}
                      fontWeight={strong ? 500 : 400}
                      fill={strong ? "var(--ink)" : "var(--ink-3)"}
                    >
                      {m.label}
                    </text>
                  </g>
                );
              })}
              {hasBench && (
                <path d={benchPath} fill="none" stroke="var(--bench)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              )}
              <path d={stockPath} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {!narrow &&
                ends.map((e, i) => (
                  <g key={e.key}>
                    <circle cx={innerW} cy={y(e.v)} r={4} fill={e.color} stroke="var(--surface)" strokeWidth={2} />
                    {Math.abs(endY[i] - y(e.v)) > 1 && (
                      <line x1={innerW + 5} y1={y(e.v)} x2={innerW + 10} y2={endY[i]} stroke="var(--line-strong)" />
                    )}
                    <text x={innerW + 12} y={endY[i]} dy="-0.15em" fontSize={11} fill="var(--ink-2)">{e.label}</text>
                    <text x={innerW + 12} y={endY[i]} dy="1.05em" fontSize={12} fontWeight={600} fill="var(--ink)" className="num">
                      {pct(e.v)}
                    </text>
                  </g>
                ))}
              {h && (
                <g pointerEvents="none">
                  <line x1={x(h.t)} x2={x(h.t)} y1={0} y2={innerH} stroke="var(--ink-3)" strokeWidth={1} />
                  {hasBench && h.b != null && (
                    <circle cx={x(h.t)} cy={y(h.b)} r={4} fill="var(--bench)" stroke="var(--surface)" strokeWidth={2} />
                  )}
                  <circle cx={x(h.t)} cy={y(h.s)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
                </g>
              )}
            </g>
          </svg>
        )}
        {width === 0 && <div className="skeleton absolute inset-0" />}
        {h && width > 0 && (
          <Tooltip
            left={margin.left + x(h.t)}
            top={margin.top + y(h.s)}
            width={width}
            date={h.d}
            rows={[
              { label: stockLabel, value: h.s, color: "var(--accent)" },
              ...(hasBench && h.b != null ? [{ label: benchLabel!, value: h.b, color: "var(--bench)" }] : []),
            ]}
            diff={hasBench && h.b != null ? h.s - h.b : null}
          />
        )}
      </div>
      <details className="mt-3 text-[12px] text-ink-2 group">
        <summary className="cursor-pointer text-ink-3 hover:text-ink-2 w-fit">View data table</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded border border-line">
          <table className="w-full num text-right">
            <thead className="sticky top-0 bg-surface-2 text-ink-3">
              <tr>
                <th className="text-left font-normal px-3 py-1.5">Date</th>
                <th className="font-normal px-3 py-1.5">{stockLabel}</th>
                {hasBench && <th className="font-normal px-3 py-1.5">{benchLabel}</th>}
              </tr>
            </thead>
            <tbody>
              {thin(data, 60).map((p) => (
                <tr key={p.d} className="border-t border-line">
                  <td className="text-left px-3 py-1">{fmtDate(p.d)}</td>
                  <td className="px-3 py-1">{pct(p.s)}</td>
                  {hasBench && <td className="px-3 py-1">{pct(p.b)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function thin<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  const step = (xs.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => xs[Math.round(i * step)]);
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="14" height="4" aria-hidden><line x1="1" x2="13" y1="2" y2="2" stroke={color} strokeWidth="2" strokeLinecap="round" /></svg>
      {label}
    </span>
  );
}

function Tooltip({
  left, top, width, date, rows, diff,
}: {
  left: number; top: number; width: number; date: string;
  rows: { label: string; value: number; color: string }[]; diff: number | null;
}) {
  const flip = left > width - 210;
  return (
    <div
      className="absolute pointer-events-none z-10 rounded-md border border-line bg-surface shadow-card px-3 py-2 text-[12px] min-w-[170px]"
      style={{ left: flip ? left - 14 : left + 14, top: Math.max(0, top - 40), transform: flip ? "translateX(-100%)" : undefined }}
    >
      <div className="text-ink-3 mb-1">{fmtDate(date)}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 py-0.5">
          <svg width="10" height="2" aria-hidden><line x1="0" x2="10" y1="1" y2="1" stroke={r.color} strokeWidth="2" /></svg>
          <span className="font-semibold text-ink num">{pct(r.value)}</span>
          <span className="text-ink-2 truncate">{r.label}</span>
        </div>
      ))}
      {diff != null && (
        <div className="mt-1 pt-1 border-t border-line text-ink-2 num">Difference {pp(diff)}</div>
      )}
    </div>
  );
}
