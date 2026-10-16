"use client";

// "Look up a company": name or ticker -> its page, with everything the site has on it.
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Logo } from "@/components/logo";

type Hit = { cik: number; name: string; ticker: string | null };

const tidy = (name: string) => {
  const n = name.replace(/\s*\/\s*[A-Z]{2}\/?$/, "").replace(/,?\s+(INC|CORP|CORPORATION|HOLDINGS?|CO)\.?$/i, "");
  return n === n.toUpperCase() ? n.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()) : n;
};

export function CompanySearch({ placeholder = "Look up a company…", compact = false }: { placeholder?: string; compact?: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const router = useRouter();
  const id = useId();
  const seq = useRef(0);

  useEffect(() => {
    const s = q.trim();
    const n = ++seq.current;
    if (s.length < 2) return;
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/hiw/search?q=${encodeURIComponent(s)}`);
        const json = (await res.json()) as { results: Hit[] };
        if (n === seq.current) {
          setHits(json.results);
          setActive(0);
        }
      } catch {
        /* offline or aborted: keep the last results */
      }
    }, 150);
    return () => window.clearTimeout(t);
  }, [q]);

  const shown = q.trim().length >= 2 ? hits : [];
  const go = (h: Hit | undefined) => {
    if (!h) return;
    setQ("");
    setHits([]);
    router.push(`/case/${h.cik}`);
  };

  return (
    <div className={`relative ${compact ? "w-full md:w-[260px]" : "w-full max-w-[460px]"}`}>
      <label htmlFor={id} className="sr-only">Look up a company by name or ticker</label>
      <input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoComplete="off"
             role="combobox" aria-expanded={shown.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
             aria-activedescendant={shown.length ? `${id}-${active}` : undefined}
             onKeyDown={(e) => {
               if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
               else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
               else if (e.key === "Enter") { e.preventDefault(); go(shown[active]); }
               else if (e.key === "Escape") { setQ(""); }
             }}
             className={`w-full rounded-full border border-line-strong bg-bg px-4 text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent ${compact ? "min-h-10 text-[13px]" : "min-h-12 text-[15px]"}`} />
      {shown.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-40 mt-1 w-full overflow-hidden rounded-[12px] border border-line bg-surface-2 shadow-card">
          {shown.map((h, i) => (
            <li key={h.cik} id={`${id}-${i}`} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)}
                      className={`flex w-full min-h-11 items-center gap-2 px-3 text-left text-[13px] text-ink ${i === active ? "bg-surface-3" : "hover:bg-surface-3"}`}>
                <Logo cik={h.cik} size={22} /><span className="truncate">{tidy(h.name)}</span>
                {h.ticker && <span className="ml-auto font-mono text-ink-3">{h.ticker}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
