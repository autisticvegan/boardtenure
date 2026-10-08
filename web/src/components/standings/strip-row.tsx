"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

export type StripDot = {
  key: string;
  href: string;
  x: number; // annualized excess
  hollow?: boolean;
  ring?: boolean;
  caption?: string;
  tip: ReactNode;
};

const ROW_H = 36;
const LANES = [0, -9, 9];
const NEAR = 8; // a dot within this many px of an earlier one moves to another lane
const SNAP = 12;
const CAPTION_CHAR_W = 6.2; // ~10px Inter caps
const CAPTION_H = 10;
const CAPTION_GAP = 3; // min px between neighbouring captions
const GRACE = 200; // ms the tooltip waits before closing, so the pointer can move onto it

const MD_QUERY = "(min-width: 768px)";
function subscribeMd(cb: () => void) {
  const mq = window.matchMedia(MD_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useIsMd = () => useSyncExternalStore(subscribeMd, () => window.matchMedia(MD_QUERY).matches, () => false);

type Box = { x0: number; x1: number; y0: number; y1: number };
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * One-row dot strip on a shared symmetric domain (BoardStrips, Many hats, Same boardroom).
 * Dots are pointer-only affordances; the row label is the keyboard stop and srSummary carries
 * the same information for screen readers. Below md the dots are smaller and static (no
 * tooltips, no taps): the label link is the control.
 */
export function StripRow({ label, href, dots, domain, median, right, srSummary, labelWidth = 200 }: {
  label: ReactNode; href?: string; dots: StripDot[]; domain: number; median?: number | null; right?: ReactNode;
  srSummary: string; labelWidth?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const router = useRouter();
  const md = useIsMd();
  const r = md ? 4 : 3;
  const tipRef = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTip = () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); };
  const dropTip = () => {
    holdTip();
    leaveTimer.current = setTimeout(() => setHover(null), GRACE);
  };
  useEffect(() => holdTip, []);

  // Esc dismisses the tooltip (WCAG 1.4.13) until the pointer really moves again.
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
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = 8;
  const x = (v: number) => pad + ((Math.max(-domain, Math.min(domain, v)) + domain) / (2 * domain)) * (w - 2 * pad);

  // Lanes: centre first, then up, then down. When all three are taken near this x, use the lane
  // whose nearest dot is farthest away instead of piling every extra dot onto the last lane.
  const placed: { cx: number; cy: number; d: StripDot }[] = [];
  for (const d of [...dots].sort((a, b) => a.x - b.x)) {
    const cx = x(d.x);
    const gap = (lane: number) =>
      Math.min(Infinity, ...placed.filter((p) => p.cy === ROW_H / 2 + LANES[lane]).map((p) => Math.abs(p.cx - cx)));
    let lane = LANES.findIndex((_, i) => gap(i) >= NEAR);
    if (lane < 0) lane = LANES.reduce((best, _, i) => (gap(i) > gap(best) ? i : best), 0);
    placed.push({ cx, cy: ROW_H / 2 + LANES[lane], d });
  }

  // Captions sit above their dot, or below it when that collides; otherwise they drop.
  const captions: { x: number; y: number; text: string }[] = [];
  const taken: Box[] = placed.map((p) => ({ x0: p.cx - r, x1: p.cx + r, y0: p.cy - r, y1: p.cy + r }));
  for (const [i, p] of placed.entries()) {
    if (!p.d.caption) continue;
    const half = (p.d.caption.length * CAPTION_CHAR_W) / 2 + CAPTION_GAP;
    const others = taken.filter((_, j) => j !== i);
    for (const baseline of [p.cy - r - 3, p.cy + r + 2 + CAPTION_H]) {
      const box = { x0: p.cx - half, x1: p.cx + half, y0: baseline - CAPTION_H + 1, y1: baseline + 1 };
      if (!others.some((b) => overlaps(b, box))) {
        captions.push({ x: p.cx, y: baseline, text: p.d.caption });
        taken.push(box);
        break;
      }
    }
  }

  const onMove = (clientX: number, clientY: number, target: EventTarget) => {
    // Moving over the tooltip (a child of this strip) keeps it open on its dot.
    if (tipRef.current?.contains(target as Node)) { holdTip(); return; }
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect) return;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let best: number | null = null;
    let bestD = SNAP;
    placed.forEach((p, i) => {
      const dist = Math.hypot(p.cx - px, p.cy - py);
      if (dist <= bestD) { bestD = dist; best = i; }
    });
    if (best == null) { if (hover != null) dropTip(); return; }
    holdTip();
    setHover(best);
  };

  const h = md && hover != null ? placed[hover] : null;
  // srSummary rides inside the label link, so tabbing to it announces the row's numbers.
  const labelEl = href
    ? <Link href={href} className="block min-w-0 max-md:min-h-11 max-md:content-center hover:text-accent-ink">
        {label}<span className="sr-only"> {srSummary}</span>
      </Link>
    : <div className="min-w-0">{label}<span className="sr-only"> {srSummary}</span></div>;

  return (
    <div className="grid items-center gap-x-4 md:grid-cols-[var(--lw)_1fr_96px] grid-cols-[1fr_auto]"
         style={{ ["--lw" as string]: `${labelWidth}px` }}>
      <div className="min-w-0 text-[13px] leading-5 md:col-auto col-span-1">{labelEl}</div>
      <div className="md:hidden text-right text-[13px]">{right}</div>
      <div
        ref={wrap}
        className="relative col-span-2 md:col-span-1"
        style={{ height: ROW_H }}
        onPointerMove={md ? (e) => {
          if (escaped.current && !e.movementX && !e.movementY) return;
          escaped.current = false;
          onMove(e.clientX, e.clientY, e.target);
        } : undefined}
        onPointerLeave={md ? dropTip : undefined}
        onClick={md ? () => h && router.push(h.d.href) : undefined}
        aria-hidden
      >
        {w > 0 && (
          <svg width={w} height={ROW_H} className="block overflow-visible">
            <line x1={pad} x2={w - pad} y1={ROW_H / 2} y2={ROW_H / 2} stroke="var(--line)" />
            <line x1={x(0)} x2={x(0)} y1={2} y2={ROW_H - 2} stroke="var(--zero)" />
            {median != null && (
              <line x1={x(median)} x2={x(median)} y1={ROW_H / 2 - 8} y2={ROW_H / 2 + 8} stroke="var(--ink)" strokeWidth={2} />
            )}
            {placed.map((p, i) => {
              const fill = p.d.x >= 0 ? "var(--gain)" : "var(--loss)";
              return (
                <g key={p.d.key} style={md ? { cursor: "pointer" } : undefined}>
                  {p.d.ring && <circle cx={p.cx} cy={p.cy} r={7} fill="none" stroke="var(--ink)" strokeWidth={2} />}
                  <circle cx={p.cx} cy={p.cy} r={h && hover === i ? r + 1 : r}
                          fill={p.d.hollow ? "var(--surface)" : fill} stroke={p.d.hollow ? fill : "var(--surface)"}
                          strokeWidth={p.d.hollow ? 2 : 1.5} />
                </g>
              );
            })}
            {captions.map((c, i) => (
              <text key={i} x={c.x} y={c.y} textAnchor="middle" fontSize={10} fill="var(--ink-3)">{c.text}</text>
            ))}
          </svg>
        )}
        {h && w > 0 && (
          // Beside the dot (flipped left past the middle), so the pointer moves straight onto it
          // without crossing other dots; clicking it opens the seat, like the dot.
          <div ref={tipRef} onPointerEnter={holdTip}
               className="anim-tip absolute z-30 cursor-pointer rounded-lg border border-line-strong bg-surface-3 px-3 py-2 text-[12px] leading-4 text-ink shadow-card w-max max-w-[280px]"
               style={{
                 top: h.cy,
                 transform: "translateY(-50%)",
                 ...(h.cx > w / 2 ? { right: w - h.cx + r + 2 } : { left: h.cx + r + 2 }),
               }}>
            {h.d.tip}
          </div>
        )}
      </div>
      <div className="hidden md:block text-right text-[13px]">{right}</div>
    </div>
  );
}
