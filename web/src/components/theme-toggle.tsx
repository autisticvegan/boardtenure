"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

const current = (): Theme => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

export function ThemeToggle() {
  const theme = useSyncExternalStore<Theme | null>(subscribe, current, () => null);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.setAttribute("data-theme", next);
        try {
          localStorage.setItem("theme", next);
        } catch {}
      }}
      className="h-8 w-8 grid place-items-center rounded-md text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors shrink-0"
      aria-label={theme ? `Switch to ${next} mode` : "Toggle theme"}
      title={theme ? `Switch to ${next} mode` : "Toggle theme"}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" />
      </svg>
    </button>
  );
}
