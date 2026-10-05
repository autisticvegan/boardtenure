"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Hover/focus tooltip (WCAG 1.4.13): opens on hover or focus, stays open while hovered,
 * closes on Esc and blur. Never the only place essential information lives.
 */
export function Tooltip({ content, children, className = "" }: { content: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 80);
  };

  return (
    <span className={`relative inline-flex ${className}`} onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={() => setOpen(false)}
          aria-describedby={open ? id : undefined}>
      {children}
      {open && (
        <span
          id={id}
          role="tooltip"
          onPointerEnter={show}
          onPointerLeave={hide}
          className="anim-fade absolute z-40 left-1/2 -translate-x-1/2 bottom-full mb-2 w-max max-w-[280px] rounded-lg border border-line-strong bg-surface-3 px-3 py-2 text-[12px] leading-4 text-ink shadow-card"
        >
          {content}
        </span>
      )}
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
