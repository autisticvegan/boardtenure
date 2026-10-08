"use client";

import { scaleUtc } from "d3-scale";
import { utcFormat } from "d3-time-format";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fmtDate, pct, tenureLength, type Precision } from "@/lib/format";
import { perYear } from "@/lib/standings";

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
  /** Annualized excess vs the S&P 500 when the seat is scored; null when it isn't. */
  excess?: number | null;
  /** Scored but left out of the active scope (exec seat under Non-exec seats): drawn as an outline. */
  outOfScope?: boolean;
  /** Why the seat isn't scored, for the tooltip. */
  reason?: string | null;
  total_return?: number | null;
  bench_total_return?: number | null;
};

const ROW = 28;
const BAR_H = 12; // <= 24px (§6.6)
const TOP = 18; // room for the "now" label
const LABEL_W = 188;
const END_W = 76; // end-label column right of the as-of line
const EPS = 0.0005;
const t = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();

function windowEnd(iso: string, p: Precision | null): string {
  const [y, m] = iso.split("-").map(Number);
  if (p === "year") return `${y}-12-31`;
  if (p === "month") return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return iso;
}

type Tone = "gain" | "loss" | "none";
const toneOf = (r: TimelineRow): Tone =>
  r.excess == null ? "none" : r.excess >= 0 ? "gain" : "loss";
const FILL: Record<Tone, string> = { gain: "var(--gain)", loss: "var(--loss)", none: "var(--ink-3)" };
// Unscored bars at 0.7 (not §5.6's 0.55) so the grey bar keeps >= 3:1 against the surface.
const OPACITY: Record<Tone, number> = { gain: 0.85, loss: 0.85, none: 0.7 };
const GRACE = 200; // ms the tooltip waits before closing, so the pointer can move onto it
const INK: Record<Tone, string> = { gain: "var(--gain-ink)", loss: "var(--loss-ink)", none: "var(--ink-3)" };

/**
 * Who sat when: one bar per seat, tinted by the sign of the stock's annualized excess during it
 * (rankings-ui.md §5.6). Position and the signed end label carry the meaning; colour is redundant.
 * Current seats run open-ended to the as-of line, marked "now".
 */
export function BoardTimeline({ rows, ipoDate, asOf }: { rows: TimelineRow[]; ipoDate: string | null; asOf: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId();
  const gid = uid.replace(/:/g, "");
  const tipId = `${uid}-tip`;
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTip = () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); };
  const dropTip = () => {
    holdTip();
    leaveTimer.current = setTimeout(() => setHover(null), GRACE);
  };
  useEffect(() => holdTip, []);

  // Esc dismisses the tooltip (WCAG 1.4.13) until the pointer really moves again (a layout change
  // under a resting pointer must not pop the next row's tooltip).
  const escaped = useRef(false);
  const tipOpen = hover != null;
  useEffect(() => {
    if (!tipOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { escaped.current = true; setHover(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tipOpen]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const placed = useMemo(() => rows.filter((r) => r.start_date), [rows]);
  const unplaced = rows.filter((r) => !r.start_date);
  const labelW = width < 640 ? 132 : LABEL_W;
  const innerW = Math.max(0, width - labelW - END_W);

  const { x, ticks, clipStart } = useMemo(() => {
    const starts = placed.map((r) => t(r.start_date!));
    const minStart = Math.min(...starts, ipoDate ? t(ipoDate) : t(asOf));
    // Keep the listed era readable: start at most ~3 years before listing and mark earlier starts.
    const floor = ipoDate ? t(ipoDate) - 3 * 365.25 * 86_400_000 : minStart;
    const d0 = Math.max(minStart, floor);
    const x = scaleUtc().domain([d0, t(asOf)]).range([0, innerW]);
    return { x, ticks: x.ticks(width < 640 ? 4 : 8), clipStart: d0 };
  }, [placed, ipoDate, asOf, innerW, width]);

  const plotH = placed.length * ROW;
  const height = TOP + plotH + 26;
  const h = hover != null ? placed[hover] : null;
  const hasOutline = placed.some((r) => r.outOfScope && r.excess != null);
  const asOfX = x(t(asOf));

  return (
    <div>
      {/* The only sideways scroller on the site (§6.5): the timeline keeps a readable minimum width. */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div ref={wrap} className="relative min-w-[560px]">
          {width > 0 && (
            // A labelled group, not role="img": the seat names inside are real links.
            <svg width={width} height={height} className="block" role="group"
                 aria-label={`Board membership timeline: ${placed.length} seats from ${fmtDate(new Date(clipStart).toISOString().slice(0, 10), "year")} to ${fmtDate(asOf)}, each bar tinted by how the stock did against the S&P 500 per year during the seat. The Board standings table lists the same seats.`}>
              <defs>
                {(["gain", "loss", "none"] as Tone[]).map((k) => (
                  <linearGradient key={k} id={`fade-${k}-${gid}`} x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0" stopColor={FILL[k]} stopOpacity="0" />
                    <stop offset="1" stopColor={FILL[k]} stopOpacity={OPACITY[k]} />
                  </linearGradient>
                ))}
              </defs>
              <g transform={`translate(${labelW},0)`}>
                {ticks.map((d) => (
                  <g key={d.getTime()} transform={`translate(${x(d)},0)`}>
                    <line y1={TOP} y2={TOP + plotH + 4} stroke="var(--line)" />
                    <text y={height - 6} textAnchor="middle" fontSize={11} fill="var(--ink-3)" className="num">
                      {utcFormat("%Y")(d)}
                    </text>
                  </g>
                ))}
                {ipoDate && t(ipoDate) >= clipStart && (
                  <line x1={x(t(ipoDate))} x2={x(t(ipoDate))} y1={TOP} y2={TOP + plotH + 4} stroke="var(--ink-3)" strokeWidth={1} />
                )}
                {/* As-of line: current seats end here, open. */}
                <line x1={asOfX} x2={asOfX} y1={TOP - 4} y2={TOP + plotH + 4} stroke="var(--ink-3)" strokeDasharray="2 3" />
                <text x={asOfX} y={TOP - 7} textAnchor="middle" fontSize={11} fill="var(--ink-2)">now</text>
              </g>
              {placed.map((r, i) => {
                const y0 = TOP + i * ROW;
                const yBar = y0 + (ROW - BAR_H) / 2;
                const tone = toneOf(r);
                const hollow = !!r.outOfScope && r.excess != null;
                const s = Math.max(t(r.start_date!), clipStart);
                const sureFrom = Math.max(t(windowEnd(r.start_date!, r.start_precision)), clipStart);
                const cur = r.status === "current";
                const e = cur || !r.end_date ? t(asOf) : t(r.end_date);
                const x0 = x(s);
                const x1 = Math.max(x(e), x0 + 2);
                const xSure = Math.min(Math.max(x(sureFrom), x0), x1);
                const clipped = t(r.start_date!) < clipStart;
                const offChart = e < clipStart; // the whole seat precedes the visible range
                const solidW = Math.max(2, x1 - xSure);
                const endLabel = r.excess != null ? perYear(r.excess) : "not scored";
                return (
                  <g key={r.key} onPointerLeave={dropTip} className="cursor-pointer"
                     onPointerMove={(e) => {
                       if (escaped.current && !e.movementX && !e.movementY) return;
                       escaped.current = false;
                       holdTip();
                       if (hover !== i) setHover(i);
                     }}>
                    <rect x={0} y={y0} width={width} height={ROW} fill={hover === i ? "var(--surface-2)" : "transparent"} />
                    <foreignObject x={0} y={y0 + 2} width={labelW - 8} height={ROW - 4}>
                      <Link href={r.href} onFocus={() => { holdTip(); setHover(i); }} onBlur={() => setHover(null)}
                            aria-describedby={hover === i ? tipId : undefined}
                            className="flex items-center gap-1.5 h-full text-[12px] leading-none pr-1 min-w-0 rounded-sm">
                        <span className={`truncate ${cur ? "text-ink" : "text-ink-2"}`}>{r.name}</span>
                        {r.tag && <span className="shrink-0 text-[10px] text-ink-3 uppercase tracking-wide">{r.tag}</span>}
                      </Link>
                    </foreignObject>
                    <g transform={`translate(${labelW},0)`}>
                      {offChart ? (
                        <text x={4} y={y0 + ROW / 2} fontSize={11} fill="var(--ink-3)" dominantBaseline="middle">
                          ‹ {r.start_date!.slice(0, 4)}–{(r.end_date ?? "").slice(0, 4)}, before listing · {endLabel}
                        </text>
                      ) : (
                        <>
                          {xSure > x0 && (
                            <rect x={x0} y={yBar} width={xSure - x0} height={BAR_H}
                                  fill={hollow ? "none" : `url(#fade-${tone}-${gid})`}
                                  stroke={hollow ? FILL[tone] : undefined} strokeWidth={hollow ? 1.5 : undefined}
                                  strokeDasharray={hollow ? "2 2" : undefined} />
                          )}
                          <Bar x={xSure} y={yBar} w={solidW} open={cur} hollow={hollow} color={FILL[tone]} opacity={OPACITY[tone]} />
                          {clipped && (
                            // On its own surface-3 pill, so the label keeps 4.5:1 on any bar colour.
                            <g>
                              <rect x={x0 + 2} y={yBar} width={36} height={BAR_H} rx={3} fill="var(--surface-3)" />
                              <text x={x0 + 5} y={y0 + ROW / 2 + 0.5} fontSize={10} dominantBaseline="middle" fill="var(--ink-2)">
                                ‹ {r.start_date!.slice(0, 4)}
                              </text>
                            </g>
                          )}
                          <text x={x1 + 6} y={y0 + ROW / 2 + 0.5} fontSize={11} fontWeight={r.excess != null ? 600 : 400}
                                dominantBaseline="middle" fill={r.excess != null && Math.abs(r.excess) < EPS ? "var(--ink-2)" : INK[tone]}
                                className="num">
                            {endLabel}
                          </text>
                        </>
                      )}
                    </g>
                  </g>
                );
              })}
            </svg>
          )}
          {width === 0 && <div className="skeleton" style={{ height }} />}
          {h && width > 0 && (
            // Overlaps the hovered row's bottom edge, so the pointer moves straight onto it.
            <div
              id={tipId}
              role="tooltip"
              onPointerEnter={holdTip}
              onPointerLeave={dropTip}
              className="anim-tip absolute z-10 rounded-lg border border-line-strong bg-surface-3 shadow-card px-3 py-2 text-[12px] leading-4 w-max max-w-[280px]"
              style={{
                top: TOP + (hover ?? 0) * ROW + ROW - 4,
                left: Math.max(0, Math.min(width - 240, labelW + 8)),
              }}
            >
              <div className="font-semibold text-ink">{h.name}</div>
              <div className="text-ink-2 num">
                {fmtDate(h.start_date, h.start_precision)} – {h.status === "current" ? "present" : h.end_date ? fmtDate(h.end_date, h.end_precision ?? "day") : "Unknown"}
                {" · "}{tenureLength(h.start_date, h.end_date, h.start_precision)}
              </div>
              {h.excess != null ? (
                <>
                  <div className="text-ink-2 num">{perYear(h.excess)} vs S&amp;P 500</div>
                  {h.total_return != null && (
                    <div className="text-ink-2 num">Stock {pct(h.total_return)} · S&amp;P 500 {pct(h.bench_total_return)}</div>
                  )}
                  {h.outOfScope && <div className="text-ink-2">Exec seat · not in Non-exec seats scores</div>}
                </>
              ) : (
                <div className="text-ink-2">Not scored{h.reason ? ` · ${h.reason}` : ""}</div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[12px] leading-4 text-ink-3">
        <span className="inline-flex items-center gap-1.5"><Swatch color="var(--gain)" opacity={0.85} /><span aria-hidden>▲</span> Beat the S&amp;P</span>
        <span className="inline-flex items-center gap-1.5"><Swatch color="var(--loss)" opacity={0.85} /><span aria-hidden>▼</span> Trailed</span>
        <span className="inline-flex items-center gap-1.5"><Swatch color="var(--ink-3)" opacity={OPACITY.none} />Grey: not scored</span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="w-4 h-2 rounded-sm" style={{ background: "linear-gradient(90deg, transparent, var(--ink-3))" }} />
          Fade: start known only to month or year
        </span>
        {hasOutline && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="w-3 h-2 rounded-sm border-[1.5px] border-ink-3" />Outline: exec seat, left out of Non-exec seats
          </span>
        )}
        {ipoDate && <span className="inline-flex items-center gap-1.5"><span aria-hidden className="w-px h-3 bg-ink-3" />IPO {fmtDate(ipoDate)}</span>}
      </div>
      {unplaced.length > 0 && (
        <p className="mt-2 text-[12px] leading-4 text-ink-3">
          Start date not yet established: {unplaced.map((r) => r.name).join(", ")}.
        </p>
      )}
    </div>
  );
}

/** A seat bar: rounded at both ends when closed; square and running into the as-of line when open. */
function Bar({ x, y, w, open, hollow, color, opacity }: {
  x: number; y: number; w: number; open: boolean; hollow: boolean; color: string; opacity: number;
}) {
  const r = Math.min(3, w / 2);
  const right = open ? 0 : r;
  const d = `M${x + r},${y} H${x + w - right} ${right ? `A${right},${right} 0 0 1 ${x + w},${y + right} V${y + BAR_H - right} A${right},${right} 0 0 1 ${x + w - right},${y + BAR_H}` : `V${y + BAR_H}`} H${x + r} A${r},${r} 0 0 1 ${x},${y + BAR_H - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
  return hollow
    ? <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
    : <path d={d} fill={color} opacity={opacity} />;
}

function Swatch({ color, opacity }: { color: string; opacity: number }) {
  return <span aria-hidden className="w-3 h-2 rounded-sm" style={{ background: color, opacity }} />;
}
