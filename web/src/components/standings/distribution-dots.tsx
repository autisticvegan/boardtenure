"use client";

// Where everyone lands (§5.2 DistributionDots): one dot per ranked director, binned by score on the
// page's symmetric domain. Desktop: one tab stop, arrow-key stepping, live region, tooltip, two
// template annotations. Mobile: static, 5pp bins, no annotations; the standings table is the equivalent.

import { bin } from "d3-array";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { pct } from "@/lib/format";
import { floorYears, perYear, rankLabel, srRank } from "@/lib/standings";

export type DistPoint = {
  slug: string;
  name: string;
  href: string;
  score: number;
  rank: number;
  tie: boolean;
  scored_seats: number;
  scored_years: number;
  tickers: string[];
  hollow: boolean; // All seats: the score includes a scored exec seat
};

const EPS = 0.0005;
const PAD_X = 14;
const TOP = 26; // "S&P 500 pace" label row
const BOTTOM = 58; // tick labels, median label, axis title
const LINE = 14;
const CHAR_W = 6.6; // ~12px Inter
const SNAP = 12;
const GRACE = 200; // ms the pointer tooltip waits before closing, so the pointer can move onto it

const MD_QUERY = "(min-width: 768px)";
function subscribeMd(cb: () => void) {
  const mq = window.matchMedia(MD_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useIsMd = () =>
  useSyncExternalStore(subscribeMd, () => window.matchMedia(MD_QUERY).matches, () => true);

const fillFor = (s: number) => (s >= EPS ? "var(--gain)" : s <= -EPS ? "var(--loss)" : "var(--ink-3)");

const SUFFIX = /^(jr|sr|ii|iii|iv|v|phd|md)\.?$/i;
/** "Lawrence J. Ellison" → "Ellison"; "Mary Agnes (Maggie) Wilderotter" → "Wilderotter". */
function shortName(full: string): string {
  const parts = full.replace(/\([^)]*\)/g, " ").replace(/,/g, " ").split(/\s+/).filter(Boolean);
  while (parts.length > 1 && SUFFIX.test(parts[parts.length - 1])) parts.pop();
  return parts[parts.length - 1] ?? full;
}

/** Screen-reader rank: "Jane Doe: tied for 195th, out of 199" (srRank wording, never "T-195"). */
function srWho(p: DistPoint, of: number): string {
  const r = srRank(p.rank, p.tie, of);
  return `${p.name}: ${r.startsWith("Rank ") ? r : `${r.charAt(0).toLowerCase()}${r.slice(1)}, out of ${of}`}`;
}

function tipLines(p: DistPoint, of: number, showHollow: boolean): string[] {
  const lines = [
    `${rankLabel(p.rank, p.tie)} of ${of} · ${p.name}`,
    `${perYear(p.score)} vs S&P 500`,
    `${p.scored_seats} scored seat${p.scored_seats === 1 ? "" : "s"} · ${floorYears(p.scored_years)} yrs · ${p.tickers.join(", ")}`,
  ];
  if (showHollow && p.hollow) lines.push("Includes an exec seat");
  return lines;
}

type Layout = {
  binW: number; // pp
  r: number;
  step: number;
  stacks: { center: number; pts: number[] }[]; // indexes into points, bottom → top
  pos: { col: number; j: number }[]; // per point
  maxStack: number;
  over: { left: number; right: number };
};

function layoutBins(points: DistPoint[], domain: number, md: boolean): Layout {
  const d = domain * 100;
  const binW = md ? 2.5 : 5;
  const r = md ? 4 : 3;
  const thresholds: number[] = [];
  for (let t = -d + binW; t < d - 1e-9; t += binW) thresholds.push(t);
  const clampPP = (s: number) => Math.min(d - 1e-6, Math.max(-d, s * 100));
  const idx = points.map((_, i) => i);
  const bins = bin<number, number>().domain([-d, d]).thresholds(thresholds).value((i) => clampPP(points[i].score))(idx);
  const pos: Layout["pos"] = new Array(points.length);
  const stacks = bins.map((b, col) => {
    // Extremes on top, so the #1 and last-ranked dots end their stacks.
    const pts = [...b].sort((a, c) => Math.abs(points[a].score) - Math.abs(points[c].score) || points[c].rank - points[a].rank);
    pts.forEach((p, j) => (pos[p] = { col, j }));
    return { center: ((b.x0 ?? 0) + (b.x1 ?? 0)) / 2 / 100, pts };
  });
  return {
    binW, r, step: 2 * r + 1, stacks, pos,
    maxStack: Math.max(0, ...stacks.map((s) => s.pts.length)),
    over: {
      left: points.filter((p) => p.score < -domain).length,
      right: points.filter((p) => p.score > domain).length,
    },
  };
}

/** Plot height before any annotation needs: never squeezes a stack. */
function baseHeight(l: Layout, height: number) {
  return Math.max(height, BOTTOM + TOP + 4 + l.maxStack * l.step);
}

type Block = { lines: { text: string; strong: boolean }[]; anchor: "start" | "end"; col: number; target: number | null; glyph: string | null };

export function DistributionDots({ points, domain, median, of, ofLabel = "directors", highlight, height = 220, interactive = true, showHollow = false }: {
  points: DistPoint[]; // in SQL rank order
  domain: number;
  median: number | null;
  of: number;
  ofLabel?: string;
  highlight?: string;
  height?: number;
  interactive?: boolean;
  showHollow?: boolean; // All seats: hollow rings + legend entry
}) {
  const md = useIsMd();
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [active, setActive] = useState<{ i: number; via: "key" | "pointer" } | null>(null);
  const [live, setLive] = useState("");
  const router = useRouter();
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTip = () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); };
  const dropTip = () => {
    holdTip();
    leaveTimer.current = setTimeout(() => setActive((a) => (a?.via === "pointer" ? null : a)), GRACE);
  };
  useEffect(() => holdTip, []);

  // Esc dismisses a pointer tooltip too (WCAG 1.4.13), not only the keyboard one, until the pointer
  // really moves again.
  const escaped = useRef(false);
  const pointerTip = active?.via === "pointer";
  useEffect(() => {
    if (!pointerTip) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { escaped.current = true; setActive(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pointerTip]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mobileHeight = Math.min(height, 180);
  const lMd = useMemo(() => layoutBins(points, domain, true), [points, domain]);
  const lSm = useMemo(() => layoutBins(points, domain, false), [points, domain]);
  const L = md ? lMd : lSm;
  const canInteract = interactive && md && points.length > 0;

  // ---- geometry (needs the measured width) ----
  const x = (v: number) => PAD_X + ((Math.max(-domain, Math.min(domain, v)) + domain) / (2 * domain)) * (w - 2 * PAD_X);
  const colTop = (col: number, H: number) => H - BOTTOM - L.stacks[col].pts.length * L.step; // top edge of the stack

  const hi = highlight ? points.findIndex((p) => p.slug === highlight) : -1;

  // Annotation blocks: overflow markers (always), plus #1/last (or the highlight) on desktop.
  const blocks: Block[] = [];
  const edgeCols = { left: 0, right: L.stacks.length - 1 };
  const overflowLine = (side: "left" | "right", n: number) =>
    ({ text: `${n} beyond ${pct(side === "left" ? -domain : domain, 0)}`, strong: false });
  if (L.over.right > 0) blocks.push({ lines: [overflowLine("right", L.over.right)], anchor: "end", col: edgeCols.right, target: null, glyph: "›" });
  if (L.over.left > 0) blocks.push({ lines: [overflowLine("left", L.over.left)], anchor: "start", col: edgeCols.left, target: null, glyph: "‹" });
  if (md && points.length > 0) {
    const targets: { i: number; text: string }[] = [];
    if (highlight) {
      const i = points.findIndex((p) => p.slug === highlight);
      if (i >= 0) targets.push({ i, text: points[i].name });
    } else {
      const first = 0;
      const last = points.length - 1;
      const label = (i: number) => `${rankLabel(points[i].rank, points[i].tie)} ${shortName(points[i].name)} ${perYear(points[i].score)}`;
      targets.push({ i: first, text: label(first) });
      if (last !== first) targets.push({ i: last, text: label(last) });
    }
    for (const t of targets) {
      const col = L.pos[t.i].col;
      const merged = blocks.find((b) => b.col === col && b.target == null);
      // A label over an overflow stack joins that block (above the count), so no line crosses text.
      if (merged) {
        merged.lines.push({ text: t.text, strong: true });
        merged.target = t.i;
      } else {
        const right = L.stacks[col].center >= 0;
        blocks.push({ lines: [{ text: t.text, strong: true }], anchor: right ? "end" : "start", col, target: t.i, glyph: null });
      }
    }
  }

  // Place blocks above every stack their text spans; grow the plot if a block needs more room.
  let H = baseHeight(L, md ? height : mobileHeight);
  type Placed = { b: Block; x: number; x0: number; x1: number; maxN: number; bottom: number; top: number; leader: boolean };
  const placed: Placed[] = [];
  if (w > 0) {
    for (const b of blocks) {
      const cx = x(L.stacks[b.col].center);
      const width = Math.max(...b.lines.map((l) => l.text.length * CHAR_W));
      const ax = b.anchor === "end" ? Math.min(w - 2, cx + L.r + 2) : Math.max(2, cx - L.r - 2);
      const x0 = b.anchor === "end" ? ax - width : ax;
      const x1 = b.anchor === "end" ? ax : ax + width;
      let maxN = 0;
      for (const s of L.stacks) {
        const sx = x(s.center);
        if (sx + L.r >= x0 && sx - L.r <= x1) maxN = Math.max(maxN, s.pts.length);
      }
      H = Math.max(H, BOTTOM + maxN * L.step + (b.glyph ? 12 : 0) + 8 + b.lines.length * LINE + TOP);
      placed.push({ b, x: ax, x0, x1, maxN, bottom: 0, top: 0, leader: b.glyph == null });
    }
    for (const p of placed) {
      p.bottom = H - BOTTOM - p.maxN * L.step - (p.b.glyph ? 12 : 0) - 8;
      p.top = p.bottom - p.b.lines.length * LINE;
    }
    // If the two labels collide, the bottom-of-the-table label moves below the axis.
    const a = placed.find((p) => p.b.target === 0);
    const c = placed.find((p) => p.b.target === points.length - 1 && p.b.target !== 0);
    if (!highlight && a && c && c.b.glyph == null && a.x0 < c.x1 + 8 && c.x0 < a.x1 + 8 && a.top < c.bottom && c.top < a.bottom) {
      c.bottom = H + LINE + 2;
      c.top = c.bottom - LINE;
      c.leader = false;
      H += LINE + 6;
    }
  }
  const y0 = H - BOTTOM; // baseline
  const dotY = (j: number) => y0 - L.r - 1 - j * L.step;
  const dotXY = (i: number) => ({ cx: x(L.stacks[L.pos[i].col].center), cy: dotY(L.pos[i].j) });

  // ---- interaction ----
  const announce = (i: number) => setLive([srWho(points[i], of), ...tipLines(points[i], of, showHollow).slice(1)].join(". "));
  const go = (i: number) => router.push(points[i].href);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!canInteract) return;
    const n = points.length;
    const cur = active?.i;
    let next: number | null = null;
    // Points are in rank order: → moves right on the axis (toward #1), ← toward the last rank.
    // The first arrow press lands on the highlighted director when there is one.
    if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && cur == null && hi >= 0) next = hi;
    else if (e.key === "ArrowRight") next = cur == null ? n - 1 : Math.max(0, cur - 1);
    else if (e.key === "ArrowLeft") next = cur == null ? 0 : Math.min(n - 1, cur + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Enter" && cur != null) { e.preventDefault(); go(cur); return; }
    else if (e.key === "Escape") { setActive(null); setLive(""); return; }
    if (next == null) return;
    e.preventDefault();
    setActive({ i: next, via: "key" });
    announce(next);
  };
  const nearest = (e: { clientX: number; clientY: number; currentTarget: Element }): number | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    let best: number | null = null;
    let bestD = SNAP;
    for (let i = 0; i < points.length; i++) {
      const { cx, cy } = dotXY(i);
      const dist = Math.hypot(cx - px, cy - py);
      if (dist <= bestD) { bestD = dist; best = i; }
    }
    return best;
  };

  const ticks: number[] = [];
  for (let t = -Math.round(domain * 10); t <= Math.round(domain * 10); t++) ticks.push(t / 10);
  // Narrow plots label every 20pp (keeping 0%); tick marks stay every 10pp.
  const labelEvery = w > 0 && (w - 2 * PAD_X) / Math.max(1, ticks.length - 1) < 40 ? 20 : 10;
  const order = useMemo(() => points.map((_, i) => i).sort((a, b) => points[a].score - points[b].score), [points]);
  const act = active && w > 0 ? { ...dotXY(active.i), p: points[active.i], i: active.i } : null;
  const minS = points.length ? points[points.length - 1].score : 0;
  const maxS = points.length ? points[0].score : 0;
  const hiNote = hi >= 0 ? ` ${srWho(points[hi], of)}.` : "";

  const groupProps = canInteract
    ? {
        tabIndex: 0,
        role: "group",
        "aria-roledescription": "dot plot",
        "aria-label": `${points.length} ranked ${ofLabel} by score: stock vs S&P 500 per year, on a scale of ${pct(-domain, 0)} to ${pct(domain, 0)}.${hiNote} Use the left and right arrow keys to step through them.`,
        onKeyDown: onKey,
        onBlur: () => active?.via === "key" && setActive(null),
      }
    : {
        role: "img",
        "aria-label": `${points.length} ranked ${ofLabel} by score: stock vs S&P 500 per year during the seats, from ${perYear(minS)} to ${perYear(maxS)} on a scale of ${pct(-domain, 0)} to ${pct(domain, 0)}${median != null ? `; median ${perYear(median)}` : ""}.${hiNote}`,
      };

  return (
    <div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[12px] leading-4 text-ink-2" aria-label="Legend">
        <li className="inline-flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" fill="var(--gain)" /></svg>
          <span aria-hidden>▲</span> Beat the S&amp;P
        </li>
        <li className="inline-flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" fill="var(--loss)" /></svg>
          <span aria-hidden>▼</span> Trailed the S&amp;P
        </li>
        {showHollow && (
          <li className="inline-flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="3.5" fill="none" stroke="var(--ink-2)" strokeWidth="1.5" /></svg>
            Score includes an exec seat
          </li>
        )}
      </ul>
      <div
        ref={wrap}
        {...groupProps}
        className="relative rounded-lg h-[var(--h-sm)] md:h-[var(--h-md)]"
        style={{
          ["--h-md" as string]: `${w > 0 && md ? H : baseHeight(lMd, height)}px`,
          ["--h-sm" as string]: `${w > 0 && !md ? H : baseHeight(lSm, mobileHeight)}px`,
        }}
      >
        {w > 0 && (
          <svg
            width={w}
            height={H}
            className="block overflow-visible"
            aria-hidden
            onPointerMove={canInteract ? (e) => {
              if (escaped.current && !e.movementX && !e.movementY) return;
              escaped.current = false;
              const i = nearest(e);
              if (i == null) { if (active?.via === "pointer") dropTip(); return; }
              holdTip();
              setActive({ i, via: "pointer" });
            } : undefined}
            onPointerLeave={canInteract ? () => active?.via === "pointer" && dropTip() : undefined}
            onClick={canInteract ? (e) => { const i = nearest(e); if (i != null) go(i); } : undefined}
            style={{ cursor: canInteract && active?.via === "pointer" ? "pointer" : undefined }}
          >
            {/* axis */}
            <line x1={PAD_X} x2={w - PAD_X} y1={y0} y2={y0} stroke="var(--line-strong)" />
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={y0} y2={y0 + 3} stroke="var(--line-strong)" />
                {Math.round(t * 100) % labelEvery === 0 && (
                  <text x={x(t)} y={y0 + 18} textAnchor="middle" fontSize={12} fill="var(--ink-3)" className="num">{pct(t, 0)}</text>
                )}
              </g>
            ))}
            <text x={w / 2} y={y0 + 50} textAnchor="middle" fontSize={11} fill="var(--ink-3)">
              Stock vs S&amp;P 500, % per year during the seat(s)
            </text>
            {/* zero: S&P 500 pace */}
            <line x1={x(0)} x2={x(0)} y1={18} y2={y0} stroke="var(--zero)" />
            <text x={x(0)} y={12} textAnchor="middle" fontSize={12} fill="var(--ink-2)">S&amp;P 500 pace</text>
            {/* median */}
            {median != null && (
              <>
                <line x1={x(median)} x2={x(median)} y1={y0 + 1} y2={y0 + 8} stroke="var(--ink)" strokeWidth={2} />
                <text x={Math.min(w - PAD_X - 50, Math.max(PAD_X + 50, x(median)))} y={y0 + 34} textAnchor="middle" fontSize={12} fill="var(--ink-3)">
                  Median {perYear(median)}
                </text>
              </>
            )}
            {/* leaders sit behind the dots */}
            {placed.filter((p) => p.leader && p.b.target != null).map((p) => {
              const { cx, cy } = dotXY(p.b.target!);
              return <line key={`l-${p.b.col}`} x1={cx} x2={cx} y1={p.bottom + 2} y2={cy - L.r - 2} stroke="var(--ink-2)" />;
            })}
            {order.map((i, k) => {
              const p = points[i];
              const { cx, cy } = dotXY(i);
              const fill = fillFor(p.score);
              const hollow = showHollow && p.hollow;
              return (
                <circle
                  key={p.slug}
                  cx={cx}
                  cy={cy}
                  r={hollow ? L.r - 1 : L.r}
                  fill={hollow ? "var(--surface)" : fill}
                  stroke={hollow ? fill : "none"}
                  strokeWidth={hollow ? 2 : 0}
                  className="anim-rise-sm"
                  style={{ animationDelay: `${Math.min(k * 2, 150)}ms` }}
                />
              );
            })}
            {hi >= 0 && (() => { const { cx, cy } = dotXY(hi); return <circle cx={cx} cy={cy} r={7} fill="none" stroke="var(--ink)" strokeWidth={2} />; })()}
            {act && <circle cx={act.cx} cy={act.cy} r={7} fill="none" stroke="var(--ink)" strokeWidth={2} />}
            {/* annotation blocks: glyph on the stack, count above it, label on top */}
            {placed.map((p) => {
              const cx = x(L.stacks[p.b.col].center);
              return (
                <g key={`b-${p.b.col}`}>
                  {p.b.glyph && (
                    <text x={cx} y={colTop(p.b.col, H) - 3} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--ink-2)">{p.b.glyph}</text>
                  )}
                  {p.b.lines.map((l, k) => (
                    <text key={k} x={p.x} y={p.bottom - k * LINE - 3} textAnchor={p.b.anchor} fontSize={l.strong ? 12 : 11}
                          fontWeight={l.strong ? 600 : 400} fill={l.strong ? "var(--ink)" : "var(--ink-3)"} className="num">
                      {l.text}
                    </text>
                  ))}
                </g>
              );
            })}
          </svg>
        )}
        {act && (
          // Beside the dot (flipped left past the middle), so the pointer can move onto it without
          // crossing other dots; it stays open while hovered and closes on Esc.
          <div
            aria-hidden
            onPointerEnter={holdTip}
            onPointerLeave={() => active?.via === "pointer" && dropTip()}
            onClick={() => go(act.i)}
            className="anim-tip absolute z-30 w-max max-w-[260px] cursor-pointer rounded-lg border border-line-strong bg-surface-3 px-3 py-2 text-[12px] leading-4 text-ink shadow-card"
            style={{
              top: Math.min(Math.max(act.cy, 30), H - 30),
              transform: "translateY(-50%)",
              ...(act.cx > w / 2 ? { right: w - act.cx + L.r + 2 } : { left: act.cx + L.r + 2 }),
            }}
          >
            {tipLines(act.p, of, showHollow).map((l, k) => (
              <span key={k} className={`block ${k === 0 ? "font-semibold text-ink" : "text-ink-2"}`}>{l}</span>
            ))}
          </div>
        )}
      </div>
      {canInteract && <p className="sr-only" aria-live="polite">{live}</p>}
    </div>
  );
}
