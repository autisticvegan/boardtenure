"use client";

// FilterBar for /rankings (docs/design/rankings-ui.md §5.3). The URL is the only state: every
// control navigates (router.replace / push inside one transition) and the server re-filters the
// already-ranked rows. While a navigation is pending the results region is aria-busy and dimmed.

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext, useContext, useEffect, useId, useOptimistic, useRef, useState, useTransition,
  type KeyboardEvent, type MouseEvent, type ReactNode, type TransitionStartFunction,
} from "react";
import { ScopeToggle } from "./primitives";
import {
  clearHref, isFiltered, MIN_YEARS, rankingsHref, rowTwoFilterCount, tabHref,
  type MinYears, type RankingsQuery, type SortDir, type SortKey, type StatusFilter, type Tab,
} from "./rankings-query";

export type CompanyOption = { slug: string; symbol: string | null; name: string };

type Nav = { pending: boolean; start: TransitionStartFunction };
const NavContext = createContext<Nav>({ pending: false, start: (fn) => fn() });
const useNav = () => useContext(NavContext);

const STICKY_TOP = "calc(env(safe-area-inset-top, 0px) + 56px)";

/**
 * Owns the shared transition. Same-page links marked `data-nav` (or inside `[data-nav-links]`)
 * are routed through it, so tabs, scope, status, sort heads and "Clear filters" also mark the
 * results busy instead of navigating silently.
 */
export function RankingsShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.("a[data-nav], [data-nav-links] a");
    if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self")) return;
    const href = a.getAttribute("href");
    if (!href?.startsWith("/rankings")) return;
    const mode = a.dataset.nav ?? a.closest<HTMLElement>("[data-nav-links]")?.dataset.navLinks;
    e.preventDefault(); // runs before next/link's own handler, which then stands down
    start(() => {
      if (mode === "push") router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    });
  };

  return (
    <NavContext.Provider value={{ pending, start }}>
      <div data-rankings onClickCapture={onClickCapture}>{children}</div>
    </NavContext.Provider>
  );
}

/** The results region: aria-busy and 0.6 opacity while a filter change is loading (no spinner). */
export function BusyRegion({ children, className = "" }: { children: ReactNode; className?: string }) {
  const { pending } = useNav();
  return (
    <div aria-busy={pending} className={`transition-opacity duration-150 ${pending ? "opacity-60" : ""} ${className}`}>
      {children}
    </div>
  );
}

/** URL updates with an optimistic copy of the query, so controls respond before the server does. */
function useQueryNav(query: RankingsQuery) {
  const router = useRouter();
  const { start } = useNav();
  const [opt, setOpt] = useOptimistic(query, (cur: RankingsQuery, patch: Partial<RankingsQuery>) => ({ ...cur, ...patch }));
  const apply = (patch: Partial<RankingsQuery>) => {
    const href = rankingsHref(opt, patch);
    if (href === rankingsHref(opt)) return;
    start(() => {
      setOpt(patch);
      router.replace(href, { scroll: false });
    });
  };
  return { opt, apply };
}

const SEG_WRAP = "inline-flex rounded-lg border border-line bg-surface p-0.5";
const seg = (active: boolean) =>
  `grid place-items-center px-3 min-h-11 md:min-h-9 text-[13px] font-semibold rounded-md whitespace-nowrap transition-colors ${
    active ? "bg-surface-3 text-ink shadow-[inset_0_-2px_0_var(--accent)]" : "text-ink-2 hover:text-ink"
  }`;
const BUTTON =
  "inline-flex items-center justify-center gap-1.5 px-3 min-h-11 md:min-h-9 rounded-lg border border-line bg-surface text-[13px] font-semibold text-ink-2 hover:text-ink hover:border-line-strong";
const FIELD =
  "min-h-11 md:min-h-9 rounded-lg border border-line bg-surface-2 px-2.5 text-[13px] text-ink placeholder:text-ink-3 hover:border-line-strong";

const STATUS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "current", label: "Current" },
  { value: "former", label: "Former" },
];
const TABS: { value: Tab; label: string }[] = [
  { value: "directors", label: "Directors" },
  { value: "seats", label: "Seats" },
];

export function FilterBar({ query, companies }: { query: RankingsQuery; companies: CompanyOption[] }) {
  const { opt, apply } = useQueryNav(query);
  const ids = { co: useId(), more: useId(), q: useId(), min: useId() };
  const [coOpen, setCoOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const coButton = useRef<HTMLButtonElement>(null);
  const directors = opt.tab === "directors";

  // Name filter: local text, debounced 250ms into the URL. An outside change to `q` (e.g. the
  // empty state's "Clear filters") is adopted unless the person is typing.
  const [text, setText] = useState(query.q);
  const [seenQ, setSeenQ] = useState(query.q);
  const [typing, setTyping] = useState(false);
  if (query.q !== seenQ) {
    setSeenQ(query.q);
    if (!typing) setText(query.q);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  const onText = (v: string) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => applyRef.current({ q: v }), 250);
  };

  // Sticky on md+: publish the bar's height on :root so table heads stick just below it and
  // scroll-padding (globals.css) keeps focused rows out from under it.
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty("--filters-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--filters-h");
    };
  }, []);

  const selected = new Set(opt.co);
  const toggleCompany = (slug: string) => {
    const next = new Set(selected);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    apply({ co: companies.filter((c) => next.has(c.slug)).map((c) => c.slug) });
  };
  const closeCompanies = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    setCoOpen(false);
    coButton.current?.focus();
  };

  const moreCount = rowTwoFilterCount(opt);

  return (
    <div
      ref={bar}
      className="md:sticky z-20 -mx-4 px-4 sm:-mx-6 sm:px-6 py-3 bg-bg/95 backdrop-blur border-b border-line"
      style={{ top: STICKY_TOP }}
    >
      {/* Row 1: view, scope, companies */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <nav aria-label="Standings view" data-nav-links="push" className={`${SEG_WRAP} w-full md:w-auto [&>*]:flex-1`}>
          {TABS.map((t) => (
            <Link key={t.value} href={tabHref(opt, t.value)} scroll={false}
                  aria-current={opt.tab === t.value ? "page" : undefined} className={seg(opt.tab === t.value)}>
              {t.label}
            </Link>
          ))}
        </nav>
        <div data-nav-links="push" className="w-full md:w-auto">
          <ScopeToggle scope={opt.scope} hrefFor={(s) => rankingsHref(opt, { scope: s })} />
        </div>
        <div className="grid grid-cols-2 gap-2 w-full md:w-auto md:flex">
          <button ref={coButton} type="button" className={BUTTON} aria-expanded={coOpen} aria-controls={ids.co}
                  onClick={() => setCoOpen((o) => !o)}>
            Companies: {opt.co.length ? <span className="num text-ink">{opt.co.length}</span> : "All"}
            <Caret open={coOpen} />
          </button>
          <button type="button" className={`${BUTTON} md:hidden`} aria-expanded={moreOpen} aria-controls={ids.more}
                  onClick={() => setMoreOpen((o) => !o)}>
            Filters{moreCount > 0 && <span className="num text-ink">({moreCount})</span>}
            <Caret open={moreOpen} />
          </button>
        </div>
      </div>

      {/* Companies disclosure: native checkboxes that apply immediately */}
      <div id={ids.co} hidden={!coOpen} onKeyDown={closeCompanies} className="mt-3 rounded-xl border border-line bg-surface p-2 sm:p-3">
        <fieldset>
          <legend className="sr-only">Companies</legend>
          <div className="grid grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-2 gap-y-0.5">
            {companies.map((c) => (
              <label key={c.slug} className="flex items-center gap-2 min-h-11 md:min-h-9 px-2 rounded-md cursor-pointer hover:bg-surface-2 min-w-0">
                <input type="checkbox" className="size-4 shrink-0 accent-[var(--accent)]" checked={selected.has(c.slug)}
                       onChange={() => toggleCompany(c.slug)} />
                <span className="font-mono text-[12px] leading-4 font-medium text-ink-2 w-11 shrink-0">{c.symbol ?? "—"}</span>
                <span className="text-[13px] leading-5 text-ink truncate">{c.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-2 flex justify-end">
          <button type="button" className={`${BUTTON} disabled:opacity-50 disabled:pointer-events-none`} disabled={opt.co.length === 0}
                  onClick={() => apply({ co: [] })}>
            Clear
          </button>
        </div>
      </div>

      {/* Row 2: status, minimum years, multi-board, name. Behind "Filters (n)" on mobile. */}
      <div id={ids.more} className={`${moreOpen ? "flex" : "hidden"} md:flex flex-wrap items-center gap-x-5 gap-y-3 mt-3`}>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <span className="text-[12px] leading-4 text-ink-3 shrink-0">Status</span>
          <div role="group" aria-label={directors ? "Has a current scored seat" : "Seat status"} data-nav-links="replace"
               className={`${SEG_WRAP} flex-1 md:flex-none [&>*]:flex-1`}>
            {STATUS.map((s) => (
              <Link key={s.value} href={rankingsHref(opt, { status: s.value })} scroll={false}
                    aria-current={opt.status === s.value ? "true" : undefined} className={seg(opt.status === s.value)}>
                {s.label}
              </Link>
            ))}
          </div>
        </div>
        {directors && (
          <label htmlFor={ids.min} className="flex items-center gap-2 text-[12px] leading-4 text-ink-3">
            Scored years
            <select id={ids.min} className={FIELD} value={opt.min} onChange={(e) => apply({ min: Number(e.target.value) as MinYears })}>
              {MIN_YEARS.map((m) => (
                <option key={m} value={m}>{m === 2 ? "2+ (everyone ranked)" : `${m}+`}</option>
              ))}
            </select>
          </label>
        )}
        {directors && (
          <label className="flex items-center gap-2 min-h-11 md:min-h-9 text-[13px] text-ink-2 cursor-pointer">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={opt.multi}
                   onChange={(e) => apply({ multi: e.target.checked })} />
            On 2+ tracked boards
          </label>
        )}
        <form role="search" className="flex-1 min-w-[12rem] md:max-w-xs" onSubmit={(e) => {
          e.preventDefault();
          clearTimeout(timer.current);
          apply({ q: text });
        }}>
          <label htmlFor={ids.q} className="sr-only">Filter by name</label>
          <input id={ids.q} type="search" value={text} placeholder="Filter by name" autoComplete="off" spellCheck={false}
                 className={`${FIELD} w-full`} onChange={(e) => onText(e.target.value)}
                 onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} />
        </form>
        {isFiltered(opt) && (
          <Link href={clearHref(opt)} data-nav="replace" scroll={false} onClick={() => setText("")}
                className="inline-flex items-center min-h-11 md:min-h-9 text-[13px] font-semibold text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-accent-ink">
            Clear filters
          </Link>
        )}
      </div>
    </div>
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" className={`transition-transform ${open ? "rotate-180" : ""}`}>
      <path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---- mobile sort ------------------------------------------------------------------

const SORT_OPTIONS: Record<Tab, { value: `${SortKey}:${SortDir}`; label: string }[]> = {
  directors: [
    { value: "score:desc", label: "Per yr vs S&P, high to low" },
    { value: "score:asc", label: "Per yr vs S&P, low to high" },
    { value: "years:desc", label: "Scored years, most first" },
    { value: "years:asc", label: "Scored years, fewest first" },
    { value: "seats:desc", label: "Scored seats, most first" },
    { value: "seats:asc", label: "Scored seats, fewest first" },
    { value: "best:desc", label: "Best seat, high to low" },
    { value: "best:asc", label: "Best seat, low to high" },
    { value: "worst:desc", label: "Worst seat, high to low" },
    { value: "worst:asc", label: "Worst seat, low to high" },
    { value: "name:asc", label: "Name, A to Z" },
    { value: "name:desc", label: "Name, Z to A" },
  ],
  seats: [
    { value: "score:desc", label: "Per yr vs S&P, high to low" },
    { value: "score:asc", label: "Per yr vs S&P, low to high" },
    { value: "years:desc", label: "Years, longest first" },
    { value: "years:asc", label: "Years, shortest first" },
    { value: "drop:asc", label: "Worst drop, deepest first" },
    { value: "drop:desc", label: "Worst drop, smallest first" },
    { value: "name:asc", label: "Name, A to Z" },
    { value: "name:desc", label: "Name, Z to A" },
  ],
};

/** Native "Sort by" select for the mobile row blocks (column heads do this on md+). */
export function SortSelect({ query, className = "" }: { query: RankingsQuery; className?: string }) {
  const { opt, apply } = useQueryNav(query);
  const id = useId();
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label htmlFor={id} className="text-[12px] leading-4 text-ink-3">Sort by</label>
      <select id={id} className={FIELD} value={`${opt.sort}:${opt.dir}`}
              onChange={(e) => {
                const [sort, dir] = e.target.value.split(":") as [SortKey, SortDir];
                apply({ sort, dir });
              }}>
        {SORT_OPTIONS[opt.tab].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
