// DirectorsTable (docs/design/rankings-ui.md §5.3). Server component. Rows arrive already ranked
// by SQL and possibly filtered/re-sorted; the Rank column always shows the SQL rank.
import Link from "next/link";
import type { ReactNode } from "react";
import type { RankScope, ScopedDirector } from "@/lib/queries";
import { CHIP_HINT, floorYears, SCOPE_LABEL, shortRecord, tagsFor, withScope, type Tag } from "@/lib/standings";
import { Chip, ExcessBar, RankBadge, Signed, type ChipKind } from "./primitives";
import { scoredSeats, sortHref, type RankingsQuery, type SortKey } from "./rankings-query";

// ---- shared table pieces (also used by SeatsTable) ----------------------------------

/** Table heads stick below the site header plus the sticky FilterBar (it publishes --filters-h). */
const HEAD_TOP = "calc(env(safe-area-inset-top, 0px) + 56px + var(--filters-h, 0px))";

export const TABLE_CLS =
  "w-full border-separate border-spacing-0 text-[13px] leading-5 num"
  + " [&_td]:px-2.5 [&_td]:py-2 [&_td]:h-11 [&_td]:border-b [&_td]:border-line [&_tbody_tr:last-child_td]:border-b-0";

export const ROW_CLS = "relative hover:bg-surface-2 transition-colors";

/** Stretched row link: the name cell's link covers the row; nothing else in the row is interactive. */
export const ROW_LINK_CLS =
  "font-semibold text-[14px] leading-5 text-ink hover:text-accent-ink after:absolute after:inset-0";

const TH_BASE =
  "sticky z-10 bg-surface px-2.5 py-2.5 border-b border-line-strong text-[11px] leading-[14px] uppercase font-semibold tracking-[0.08em] text-ink-3 first:rounded-tl-xl last:rounded-tr-xl";

export function Th({ children, className = "", align = "left" }: { children?: ReactNode; className?: string; align?: "left" | "right" }) {
  return (
    <th scope="col" className={`${TH_BASE} ${align === "right" ? "text-right" : "text-left"} ${className}`} style={{ top: HEAD_TOP }}>
      {children}
    </th>
  );
}

/** Sortable head: `<th aria-sort>` wrapping a link to the sorted URL. */
export function SortTh({ k, query, children, className = "", align = "left" }: {
  k: SortKey; query: RankingsQuery; children: ReactNode; className?: string; align?: "left" | "right";
}) {
  const active = query.sort === k;
  return (
    <th scope="col" aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}
        className={`${TH_BASE} ${align === "right" ? "text-right" : "text-left"} ${className}`} style={{ top: HEAD_TOP }}>
      <Link href={sortHref(query, k)} data-nav="replace" scroll={false}
            className={`inline-flex items-center gap-1 min-h-6 rounded-sm hover:text-ink ${active ? "text-ink" : ""} ${align === "right" ? "flex-row-reverse" : ""}`}>
        <span>{children}</span>
        {active && <span aria-hidden className="text-[10px]">{query.dir === "asc" ? "▲" : "▼"}</span>}
      </Link>
    </th>
  );
}

export type ChipSpec = { kind: ChipKind; label: string; hint?: string };

const TAG_ORDER: Tag["key"][] = ["white-knuckle", "rocket", "rough"];

export function NoteChips({ facts, tags }: { facts: ChipSpec[]; tags: Tag[] }) {
  if (facts.length === 0 && tags.length === 0) return <span className="text-ink-3">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {facts.map((c) => <Chip key={c.label} kind={c.kind} label={c.label} hint={c.hint} wrap />)}
      {tags.map((t) => <Chip key={t.key} kind="tag" label={t.label} hint={t.hint} wrap />)}
    </span>
  );
}

// Mid-sentence sort names for table captions (keeps "S&P" capitalised).
const SORT_SENTENCE: Record<SortKey, string> = {
  score: "stock vs S&P 500 per year", years: "years", seats: "scored seats", best: "best seat", worst: "worst seat",
  name: "name", drop: "worst drop",
};

export function sortCaption(query: RankingsQuery): string {
  return `Sorted by ${SORT_SENTENCE[query.sort]}, ${query.dir === "asc" ? "ascending" : "descending"}.`;
}

// ---- director notes ---------------------------------------------------------------------

function directorNotes(d: ScopedDirector): { facts: ChipSpec[]; tags: Tag[]; mobile: ChipSpec | null } {
  const seats = scoredSeats(d);
  const short: ChipSpec | null = shortRecord(d) ? { kind: "short", label: "Short record", hint: CHIP_HINT.short } : null;
  const execSeat = seats.find((s) => s.executive_seat);
  const exec: ChipSpec | null = execSeat ? { kind: "exec", label: "Exec seat", hint: CHIP_HINT.exec(execSeat.executive_title) } : null;
  const ipoSeat = seats.find((s) => s.start_anchor_reason === "first_trade");
  const ipo: ChipSpec | null = ipoSeat ? { kind: "ipo", label: "From IPO", hint: CHIP_HINT.ipo(ipoSeat.start_anchor_date) } : null;
  const current: ChipSpec | null = d.has_current_scored ? { kind: "current", label: "Current", hint: CHIP_HINT.current } : null;

  const byKey = new Map<Tag["key"], Tag>();
  for (const s of seats) for (const t of tagsFor(s, 3)) byKey.set(t.key, t);
  const tags = TAG_ORDER.flatMap((k) => byKey.get(k) ?? []).slice(0, 2);

  const facts = [short, exec, ipo, current].filter((c): c is ChipSpec => c != null);
  const firstTag = tags[0] ? { kind: "tag" as const, label: tags[0].label, hint: tags[0].hint } : null;
  return { facts, tags, mobile: short ?? exec ?? firstTag ?? ipo ?? current };
}

function tickers(d: ScopedDirector): string {
  return [...new Set(scoredSeats(d).map((s) => s.symbol ?? s.company_name))].join(", ");
}

// ---- table ------------------------------------------------------------------------------------

export function DirectorsTable({ rows, of, domain, scope, query, filtered }: {
  rows: ScopedDirector[]; of: number; domain: number; scope: RankScope; query: RankingsQuery; filtered: boolean;
}) {
  const medals = query.sort === "score" && query.dir === "desc";
  const caption = `Standings: ${of} directors ranked by stock vs S&P 500 per year, ${SCOPE_LABEL[scope]}.`
    + `${filtered ? ` Showing ${rows.length} that match the filters.` : ""} ${sortCaption(query)}`;
  const items = rows.map((d) => ({ d, href: withScope(`/d/${d.slug}`, scope), notes: directorNotes(d), multi: d.scored_seats > 1 }));

  return (
    <>
      <div className="max-md:hidden rounded-xl border border-line bg-surface">
        <table className={TABLE_CLS}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <Th className="w-px">Rank</Th>
              <SortTh k="name" query={query}>Director</SortTh>
              <SortTh k="score" query={query} className="w-px whitespace-nowrap">Per yr vs S&amp;P</SortTh>
              <SortTh k="seats" query={query} align="right" className="w-22">Seats beat S&amp;P</SortTh>
              <SortTh k="years" query={query} align="right" className="w-20">Scored yrs</SortTh>
              <Th className="hidden lg:table-cell w-28">Boards</Th>
              <SortTh k="best" query={query} align="right" className="hidden lg:table-cell w-20">Best seat</SortTh>
              <SortTh k="worst" query={query} align="right" className="hidden lg:table-cell w-20">Worst seat</SortTh>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ d, href, notes, multi }, i) => (
              <tr key={d.person_id} className={ROW_CLS}>
                <td><RankBadge rank={d.rank} tie={d.tie} of={d.of} medal={medals} size="sm" /></td>
                <td className="min-w-40"><Link href={href} className={ROW_LINK_CLS}>{d.full_name}</Link></td>
                <td className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-2.5">
                    <Signed value={d.score} kind="pct" className="inline-block w-14 text-right" />
                    <ExcessBar value={d.score} domain={domain} size="sm" animate={i < 10} delayMs={i * 15} />
                  </span>
                </td>
                <td className="text-right whitespace-nowrap text-ink-2">{d.beat_seats} of {d.scored_seats}</td>
                <td className="text-right text-ink-2">{floorYears(d.scored_years)}</td>
                <td className="hidden lg:table-cell font-mono text-[12px] leading-4 text-ink-2">{tickers(d)}</td>
                <td className="hidden lg:table-cell text-right"><Signed value={multi ? d.best_seat_excess : null} kind="pct" /></td>
                <td className="hidden lg:table-cell text-right"><Signed value={multi ? d.worst_seat_excess : null} kind="pct" /></td>
                <td><NoteChips facts={notes.facts} tags={notes.tags} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Below md: two-line row blocks, same rows and order, no horizontal scroll. */}
      <ol aria-label={caption} className="md:hidden rounded-xl border border-line bg-surface divide-y divide-line">
        {items.map(({ d, href, notes }, i) => (
          <li key={d.person_id} className="relative px-3 py-3 min-h-12 hover:bg-surface-2 transition-colors">
            <div className="flex items-center gap-3">
              <RankBadge rank={d.rank} tie={d.tie} of={d.of} medal={medals} size="sm" />
              <Link href={href} className={`${ROW_LINK_CLS} min-w-0 flex-1`}>{d.full_name}</Link>
              <Signed value={d.score} kind="perYear" className="text-[14px] font-semibold" />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] leading-4 text-ink-3">
              <span className="font-mono text-ink-2">{tickers(d)}</span>
              <span aria-hidden>·</span>
              <span className="num">{d.beat_seats} of {d.scored_seats} beat</span>
              <span aria-hidden>·</span>
              <span className="num">{floorYears(d.scored_years)} yrs</span>
              {notes.mobile && <span className="ml-1"><Chip kind={notes.mobile.kind} label={notes.mobile.label} hint={notes.mobile.hint} /></span>}
            </div>
            <div className="mt-2">
              <ExcessBar value={d.score} domain={domain} size="sm" width="full" animate={i < 10} delayMs={i * 15} />
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
