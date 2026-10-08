"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const EDGE = 16; // min gap to the viewport edge
const HEADER = 64; // sticky header height plus a little air: below this, open underneath instead

/**
 * Hover/focus tooltip (§5.1, WCAG 1.4.13). Renders its own trigger, a <button> holding `children`,
 * with aria-describedby pointing at the tooltip, which stays in the DOM (hidden while closed) so the
 * description exists the moment focus lands. (The button is rendered here rather than cloned from
 * children: elements passed across the server/client boundary may arrive as lazy references.)
 * Opens on hover or focus, stays open while the pointer is over it, closes on Esc and blur, and is
 * shifted to stay inside the viewport. Never the only place essential information lives.
 */
export function Tooltip({ content, children, className = "", buttonClassName = "" }: {
  content: ReactNode; children: ReactNode; className?: string; buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  // Centre over the trigger, then nudge inside the viewport; flip below when it would hide under the
  // header. Written straight to the node so the first visible frame is already in place.
  useLayoutEffect(() => {
    const el = tip.current;
    if (!open || !wrap.current || !el) return;
    const t = wrap.current.getBoundingClientRect();
    const w = el.offsetWidth;
    const centre = t.left + t.width / 2;
    const left = Math.min(Math.max(centre - w / 2, EDGE), window.innerWidth - EDGE - w);
    const below = t.top - el.offsetHeight - 8 < HEADER;
    el.style.transform = `translateX(calc(-50% + ${Math.round(left - (centre - w / 2))}px))`;
    el.style.top = below ? "calc(100% + 8px)" : "";
    el.style.bottom = below ? "auto" : "";
  }, [open]);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 80);
  };

  return (
    <span ref={wrap} className={`relative inline-flex ${className}`} onPointerEnter={show} onPointerLeave={hide}>
      <button type="button" aria-describedby={id} className={buttonClassName} onFocus={show} onBlur={() => setOpen(false)}>
        {children}
      </button>
      <span
        ref={tip}
        id={id}
        role="tooltip"
        hidden={!open}
        onPointerEnter={show}
        onPointerLeave={hide}
        className={`anim-tip absolute z-40 left-1/2 bottom-[calc(100%+8px)] w-max max-w-[min(280px,calc(100vw-32px))] rounded-lg border border-line-strong bg-surface-3 px-3 py-2 text-left text-[12px] leading-4 font-normal normal-case tracking-normal whitespace-normal text-ink shadow-card`}
      >
        {content}
      </span>
    </span>
  );
}

/** Standard tooltip body: one strong first line, secondary lines in ink-2. */
export function TipBody({ lines }: { lines: ReactNode[] }) {
  return (
    <span className="block space-y-0.5">
      {lines.filter(Boolean).map((l, i) => (
        <span key={i} className={`block ${i === 0 ? "font-semibold text-ink" : "text-ink-2"}`}>{l}</span>
      ))}
    </span>
  );
}
