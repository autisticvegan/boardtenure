// Loading skeletons (§8.3: "the existing skeleton blocks"). Shimmer is the only looping motion and
// stops under reduced motion (globals.css). Each one announces itself once through role="status".
import type { ReactNode } from "react";

export function Busy({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className} aria-busy="true">
      <span className="sr-only" role="status">{label}</span>
      <div aria-hidden className="space-y-8 md:space-y-12">{children}</div>
    </div>
  );
}

/** A section head plus a card of table-like rows. */
export function TableSkeleton({ rows = 8, head = true }: { rows?: number; head?: boolean }) {
  return (
    <div className="space-y-3">
      {head && <div className="skeleton h-6 w-48" />}
      <div className="rounded-[14px] border border-line bg-surface divide-y divide-line">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 h-12 md:h-11">
            <div className="skeleton h-6 w-10 shrink-0" />
            <div className="skeleton h-4 flex-1 max-w-[220px]" />
            <div className="skeleton h-4 w-16 shrink-0" />
            <div className="skeleton h-2.5 w-[120px] shrink-0 max-md:hidden" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A card with a few text lines and an optional tall block (chart, bars). */
export function CardSkeleton({ height = 0, lines = 3 }: { height?: number; lines?: number }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-4 md:p-5 space-y-3">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={`skeleton h-4 ${i === 0 ? "w-2/3 max-w-[420px]" : "w-full max-w-[560px]"}`} />
      ))}
      {height > 0 && <div className="skeleton w-full" style={{ height }} />}
    </div>
  );
}
