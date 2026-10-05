"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
const R = 4;
const LANES = [0, -9, 9];

/**
 * One-row dot strip on a shared symmetric domain (BoardStrips, Many hats, Same boardroom).
 * Dots are pointer-only affordances; the row label is the keyboard stop and srSummary carries
 * the same information for screen readers.
 */
export function StripRow({ label, href, dots, domain, median, right, srSummary, labelWidth = 200 }: {
  label: ReactNode; href?: string; dots: StripDot[]; domain: number; median?: number | null; right?: ReactNode;
  srSummary: string; labelWidth?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const router = useRouter();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = 8;
  const x = (v: number) => pad + ((Math.max(-domain, Math.min(domain, v)) + domain) / (2 * domain)) * (w - 2 * pad);

  // Assign lanes so dots within 8px of an earlier one move up/down.
  const placed: { cx: number; cy: number; d: StripDot }[] = [];
  for (const d of [...dots].sort((a, b) => a.x - b.x)) {
    const cx = x(d.x);
    let lane = 0;
    while (lane < LANES.length - 1 && placed.some((p) => Math.abs(p.cx - cx) < 8 && p.cy === ROW_H / 2 + LANES[lane])) lane++;
    placed.push({ cx, cy: ROW_H / 2 + LANES[lane], d });
  }

  const onMove = (clientX: number, clientY: number) => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect) return;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let best: number | null = null;
    let bestD = 12;
    placed.forEach((p, i) => {
      const dist = Math.hypot(p.cx - px, p.cy - py);
      if (dist <= bestD) { bestD = dist; best = i; }
    });
    setHover(best);
  };

  const h = hover != null ? placed[hover] : null;
  const labelEl = href
    ? <Link href={href} className="block min-w-0 hover:text-accent-ink">{label}</Link>
    : <div className="min-w-0">{label}</div>;

  return (
    <div className="grid items-center gap-x-4 md:grid-cols-[var(--lw)_1fr_96px] grid-cols-[1fr_auto]"
         style={{ ["--lw" as string]: `${labelWidth}px` }}>
      <div className="min-w-0 text-[13px] leading-5 md:col-auto col-span-1">{labelEl}<span className="sr-only">{srSummary}</span></div>
      <div className="md:hidden text-right text-[13px]">{right}</div>
      <div
        ref={wrap}
        className="relative col-span-2 md:col-span-1"
        style={{ height: ROW_H }}
        onPointerMove={(e) => onMove(e.clientX, e.clientY)}
        onPointerLeave={() => setHover(null)}
        onClick={() => h && router.push(h.d.href)}
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
                <g key={p.d.key} className={hover === i ? "" : ""} style={{ cursor: "pointer" }}>
                  {p.d.caption && (
                    <text x={p.cx} y={p.cy - 8} textAnchor="middle" fontSize={10} fill="var(--ink-3)">{p.d.caption}</text>
                  )}
                  {p.d.ring && <circle cx={p.cx} cy={p.cy} r={7} fill="none" stroke="var(--ink)" strokeWidth={2} />}
                  <circle cx={p.cx} cy={p.cy} r={hover === i ? R + 1 : R}
                          fill={p.d.hollow ? "var(--surface)" : fill} stroke={p.d.hollow ? fill : "var(--surface)"}
                          strokeWidth={p.d.hollow ? 2 : 1.5} />
                </g>
              );
            })}
          </svg>
        )}
        {h && w > 0 && (
          <div className="absolute z-30 pointer-events-none rounded-lg border border-line-strong bg-surface-3 px-3 py-2 text-[12px] leading-4 text-ink shadow-card w-max max-w-[280px]"
               style={{ left: Math.min(Math.max(h.cx, 140), w - 140), bottom: ROW_H + 4, transform: "translateX(-50%)" }}>
            {h.d.tip}
          </div>
        )}
      </div>
      <div className="hidden md:block text-right text-[13px]">{right}</div>
    </div>
  );
}
