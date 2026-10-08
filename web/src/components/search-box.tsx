"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

type Hit = { kind: "company" | "person"; slug: string; label: string; sublabel: string | null };

const hrefFor = (h: Hit) => (h.kind === "company" ? `/c/${h.slug}` : `/d/${h.slug}`);

export function SearchBox({ autoFocus = false, size = "sm" }: { autoFocus?: boolean; size?: "sm" | "lg" }) {
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  // No global shortcut ("/" or ⌘K): phase 1 has no single-key shortcuts (§7, §10.21). Tab reaches it.

  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (res.ok) {
          const body = (await res.json()) as { results: Hit[] };
          setHits(body.results);
          setActive(0);
        }
      } catch {
        /* aborted or offline: keep the previous results */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const go = (h: Hit | undefined) => {
    if (!h) return;
    setOpen(false);
    setQ("");
    setHits([]);
    input.current?.blur();
    router.push(hrefFor(h));
  };

  const shown = q.trim() ? hits : [];
  const big = size === "lg";

  return (
    <div className="relative">
      <div
        className={`flex items-center gap-2 rounded-lg border border-line bg-surface transition-colors focus-within:border-line-strong focus-within:ring-4 focus-within:ring-accent-wash ${big ? "h-12 px-4 shadow-card" : "h-9 px-3"}`}
      >
        <svg width={big ? 18 : 15} height={big ? 18 : 15} viewBox="0 0 16 16" className="text-ink-3 shrink-0" aria-hidden>
          <circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, shown.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(shown[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
              input.current?.blur();
            }
          }}
          placeholder={big ? "Search a company, ticker, or director" : "Search companies, tickers, directors"}
          aria-label="Search companies, tickers and directors"
          className={`flex-1 min-w-0 bg-transparent outline-none placeholder:text-ink-3 ${big ? "text-[16px]" : "text-[13px]"}`}
          role="combobox"
          aria-expanded={open && shown.length > 0}
          aria-controls={listId}
          aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      {open && q.trim() && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 mt-1.5 rounded-lg border border-line bg-surface shadow-card overflow-hidden z-40 py-1"
        >
          {shown.length === 0 && (
            <li className="px-3 py-2.5 text-[13px] text-ink-3">{loading ? "Searching…" : "No matches"}</li>
          )}
          {shown.map((h, i) => (
            <li
              key={`${h.kind}:${h.slug}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                go(h);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${
                i === active ? "bg-surface-3 shadow-[inset_3px_0_0_var(--focus)]" : ""
              }`}
            >
              <span
                className={`grid place-items-center h-6 min-w-6 rounded text-[10px] font-semibold tracking-wide ${h.kind === "company" ? "bg-accent-wash text-accent-ink px-1.5" : "bg-surface-3 text-ink-2"}`}
              >
                {h.kind === "company" ? (h.sublabel?.split(" ")[0] ?? "CO") : initials(h.label)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">{h.label}</span>
                {h.sublabel && h.kind === "person" && (
                  <span className="block truncate text-[12px] text-ink-3">{h.sublabel}</span>
                )}
              </span>
              <span className="text-[11px] text-ink-3">{h.kind === "company" ? "Company" : "Director"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.at(-1)?.[0] ?? "")).toUpperCase();
}
