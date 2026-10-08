"use client";

// Below md the two preview columns become tabs (←/→ between tabs). At md and up both panels show
// side by side and the tablist is hidden.

import { useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";

const MD_QUERY = "(min-width: 768px)";
function subscribeMd(cb: () => void) {
  const mq = window.matchMedia(MD_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useIsMd = () => useSyncExternalStore(subscribeMd, () => window.matchMedia(MD_QUERY).matches, () => false);

export function PreviewTabs({ panels }: { panels: { key: string; label: string; content: ReactNode }[] }) {
  const [sel, setSel] = useState(0);
  const base = useId();
  // Tab roles only while the tabs exist (below md); at md+ both columns are plain sections.
  const md = useIsMd();
  const tabbed = panels.length > 1 && !md;
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = panels.length;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (sel + 1) % n;
    else if (e.key === "ArrowLeft") next = (sel - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next == null) return;
    e.preventDefault();
    setSel(next);
    tabs.current[next]?.focus();
  };

  return (
    <div>
      {panels.length > 1 && (
        <div role="tablist" aria-label="Standings preview" onKeyDown={onKey}
             className="md:hidden mb-3 grid grid-cols-2 rounded-lg border border-line bg-surface p-0.5">
          {panels.map((p, i) => (
            <button
              key={p.key}
              ref={(el) => { tabs.current[i] = el; }}
              type="button"
              role="tab"
              id={`${base}-tab-${i}`}
              aria-selected={sel === i}
              aria-controls={`${base}-panel-${i}`}
              tabIndex={sel === i ? 0 : -1}
              onClick={() => setSel(i)}
              className={`min-h-11 rounded-md text-[13px] font-semibold ${
                sel === i ? "bg-surface-3 text-ink shadow-[inset_0_-2px_0_var(--accent)]" : "text-ink-2"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <div className={`grid gap-x-6 gap-y-8 ${panels.length > 1 ? "md:grid-cols-2" : ""}`}>
        {panels.map((p, i) => (
          <div
            key={p.key}
            role={tabbed ? "tabpanel" : undefined}
            id={`${base}-panel-${i}`}
            aria-labelledby={tabbed ? `${base}-tab-${i}` : undefined}
            className={`min-w-0 ${sel === i ? "" : "max-md:hidden"}`}
          >
            {p.content}
          </div>
        ))}
      </div>
    </div>
  );
}
