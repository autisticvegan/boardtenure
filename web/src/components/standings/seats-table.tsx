// SeatsTable (docs/design/rankings-ui.md §5.3). Server component; one row per scored seat in the
// scope, Rank column = SQL seat rank regardless of filters or sort.
import Link from "next/link";
import type { RankScope, SeatRank } from "@/lib/queries";
import { CHIP_HINT, SCOPE_LABEL, seatWindow, tagsFor, withScope, years } from "@/lib/standings";
import {
  NoteChips, ROW_CLS, ROW_LINK_CLS, SortTh, TABLE_CLS, Th, sortCaption, type ChipSpec,
} from "./directors-table";
import { Chip, ExcessBar, RankBadge, Signed } from "./primitives";
import type { RankingsQuery } from "./rankings-query";

function seatNotes(s: SeatRank) {
  const facts: ChipSpec[] = [];
  if (s.executive_seat) facts.push({ kind: "exec", label: "Exec seat", hint: CHIP_HINT.exec(s.executive_title) });
  if (s.start_anchor_reason === "first_trade") facts.push({ kind: "ipo", label: "From IPO", hint: CHIP_HINT.ipo(s.start_anchor_date) });
  if (s.seat_status === "current") facts.push({ kind: "current", label: "Current", hint: CHIP_HINT.current });
  return { facts, tags: tagsFor(s, 2) };
}

const BAR_W = 96;

/** "Jul 2010 – present", allowed to break only after the dash when the table is tight. */
function WindowText({ text }: { text: string }) {
  const [a, b] = text.split(" – ");
  return <><span className="whitespace-nowrap">{a} –</span> <span className="whitespace-nowrap">{b}</span></>;
}

export function SeatsTable({ rows, of, domain, scope, query, filtered }: {
  rows: SeatRank[]; of: number; domain: number; scope: RankScope; query: RankingsQuery; filtered: boolean;
}) {
  const caption = `Standings: ${of} scored seats ranked by stock vs S&P 500 per year, ${SCOPE_LABEL[scope]}.`
    + `${filtered ? ` Showing ${rows.length} that match the filters.` : ""} ${sortCaption(query)}`;
  const items = rows.map((s) => ({
    s,
    href: withScope(`/c/${s.company_slug}/d/${s.person_slug}`, scope),
    window: seatWindow(s.start_anchor_date, s.end_anchor_date, s.seat_status === "current"),
    notes: seatNotes(s),
  }));
  const wide = "hidden min-[1200px]:table-cell";

  return (
    <>
      <div className="max-md:hidden rounded-xl border border-line bg-surface">
        <table className={TABLE_CLS}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <Th className="w-px">Rank</Th>
              <SortTh k="name" query={query}>Director</SortTh>
              <Th className="w-px">Company</Th>
              <Th className="hidden lg:table-cell w-px">Window</Th>
              <SortTh k="years" query={query} align="right" className="w-px">Yrs</SortTh>
              <SortTh k="score" query={query} className="w-px whitespace-nowrap">Per yr vs S&amp;P</SortTh>
              <Th align="right" className="hidden lg:table-cell w-px">Stock</Th>
              <Th align="right" className={`${wide} w-px`}>S&amp;P 500</Th>
              <Th align="right" className={`${wide} w-px`}>Difference</Th>
              <SortTh k="drop" query={query} align="right" className="w-20">Worst drop</SortTh>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ s, href, window, notes }, i) => (
              <tr key={s.membership_id} className={ROW_CLS}>
                <td><RankBadge rank={s.rank} tie={s.tie} of={s.of} size="sm" /></td>
                <td className="min-w-36"><Link href={href} className={ROW_LINK_CLS}>{s.full_name}</Link></td>
                <td>
                  <span className="block font-mono text-[12px] leading-4 font-medium text-ink-2">{s.symbol ?? "—"}</span>
                  <span className="hidden min-[1200px]:block text-[12px] leading-4 text-ink-3 truncate max-w-36">{s.company_name}</span>
                </td>
                <td className="hidden lg:table-cell text-ink-2"><WindowText text={window} /></td>
                <td className="text-right text-ink-2">{years(s.calendar_days)}</td>
                <td className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-2.5">
                    <Signed value={s.annualized_excess} kind="pct" className="inline-block w-14 text-right" />
                    <ExcessBar value={s.annualized_excess} domain={domain} size="sm" width={BAR_W} animate={i < 10} delayMs={i * 15} />
                  </span>
                </td>
                <td className="hidden lg:table-cell text-right"><Signed value={s.total_return} kind="pct" /></td>
                <td className={`${wide} text-right`}><Signed value={s.bench_total_return} kind="pct" /></td>
                <td className={`${wide} text-right`}>
                  <Signed value={s.relative_return_pp} kind="pp" />
                </td>
                <td className="text-right"><Signed value={s.max_drawdown} kind="pct" /></td>
                <td><NoteChips facts={notes.facts} tags={notes.tags} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ol aria-label={caption} className="md:hidden rounded-xl border border-line bg-surface divide-y divide-line">
        {items.map(({ s, href, window, notes }, i) => {
          const chip = notes.facts.find((c) => c.kind === "exec") ?? (notes.tags[0] && { kind: "tag" as const, ...notes.tags[0] });
          return (
            <li key={s.membership_id} className="relative px-3 py-3 min-h-12 hover:bg-surface-2 transition-colors">
              <div className="flex items-center gap-3">
                <RankBadge rank={s.rank} tie={s.tie} of={s.of} size="sm" />
                <Link href={href} className={`${ROW_LINK_CLS} min-w-0 flex-1`}>{s.full_name}</Link>
                <Signed value={s.annualized_excess} kind="perYear" className="text-[14px] font-semibold" />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] leading-4 text-ink-3">
                <span className="font-mono text-ink-2">{s.symbol ?? s.company_name}</span>
                <span aria-hidden>·</span>
                <span className="num">{window}</span>
                {chip && <span className="ml-1"><Chip kind={chip.kind} label={chip.label} hint={chip.hint} /></span>}
              </div>
              <div className="mt-2">
                <ExcessBar value={s.annualized_excess} domain={domain} size="sm" width="full" animate={i < 10} delayMs={i * 15} />
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
