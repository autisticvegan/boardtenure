// BoardStandings (rankings-ui.md §4.3 row 4, §5.3): every seat on one board. Seats scored in the
// active scope come first, by annualized excess, each with its global seat-rank chip from SQL; the
// rest follow under "Not scored (n)" with a reason chip. The status filter never renumbers ranks.
import Link from "next/link";
import { daysBetween, fmtDate, pct, type Precision } from "@/lib/format";
import type { CompanySeat, RankScope } from "@/lib/queries";
import { CHIP_HINT, SCOPE_LABEL, seatReason, seatWindow, tagsFor, withScope, years, type Tag } from "@/lib/standings";
import { Chip, ExcessBar, RankBadge, Signed } from "./primitives";

export type SeatStatusFilter = "all" | "current" | "former";

export function parseStatus(v: string | string[] | undefined): SeatStatusFilter {
  return v === "current" || v === "former" ? v : "all";
}

// ---- shared seat formatting (also used by SeatCallout) ------------------------------

function fmtEdge(iso: string | null, p: Precision | null): string {
  if (!iso || p === "unknown") return "?";
  return fmtDate(iso, p === "year" ? "year" : "month");
}

type WindowFields = "start_date" | "start_precision" | "end_date" | "end_precision" | "seat_status" | "rank_eligible"
  | "start_anchor_date" | "end_anchor_date";

/**
 * "Jul 2010 – present". A measured (rank-eligible) seat shows its measured window, so it matches the
 * Yrs beside it (a From IPO seat starts at the first trading day); any other seat shows the held
 * dates at their precision ("2004 – Mar 2019").
 */
export function seatWindowLabel(s: Pick<CompanySeat, WindowFields>): string {
  const current = s.seat_status === "current";
  if (s.rank_eligible && s.start_anchor_date) return seatWindow(s.start_anchor_date, s.end_anchor_date, current);
  return `${fmtEdge(s.start_date, s.start_precision)} – ${current ? "present" : fmtEdge(s.end_date, s.end_precision)}`;
}

/** Measured years for a scored seat; otherwise the held tenure, "≈" when a date is imprecise. */
export function seatYears(s: CompanySeat, asOf: string): string {
  if (s.rank_eligible && s.calendar_days != null) return years(s.calendar_days);
  if (!s.start_date || s.start_precision === "unknown") return "—";
  const end = s.seat_status === "current" ? asOf : s.end_date;
  if (!end) return "—";
  const approx = s.start_precision !== "day" || (s.seat_status === "former" && s.end_precision !== "day");
  return `${approx ? "≈ " : ""}${years(Math.max(0, daysBetween(s.start_date, end)))}`;
}

// No "Current" chip here: the Window column already reads "– present".
type FactChip = { key: "exec" | "ipo"; label: string; hint: string };

function factChips(s: CompanySeat, scope: RankScope): FactChip[] {
  const out: FactChip[] = [];
  // Under Non-exec seats an exec seat is already explained by its reason chip.
  if (s.executive_seat && (scope === "all" || s.in_scope)) out.push({ key: "exec", label: "Exec seat", hint: CHIP_HINT.exec(s.executive_title) });
  if (s.start_anchor_reason === "first_trade") out.push({ key: "ipo", label: "From IPO", hint: CHIP_HINT.ipo(s.start_anchor_date) });
  return out;
}

function rowTags(s: CompanySeat, max: number): Tag[] {
  return s.in_scope ? tagsFor(s, max) : [];
}

// ---- component ------------------------------------------------------------------------

const TH = "px-3 py-2.5 text-[11px] leading-[14px] font-semibold uppercase tracking-[0.08em] text-ink-3 bg-surface sticky z-10 border-b border-line";
const STICKY = { top: "calc(env(safe-area-inset-top, 0px) + 56px)" };
const TD = "px-3 py-2.5 align-middle";
// Columns that only fit from 1200px; below that the table would push the page sideways (§6.5).
const WIDE = "hidden min-[1200px]:table-cell";

export function BoardStandings({ seats, status, scope, companySlug, companyName, domain, roleTags, asOf }: {
  seats: CompanySeat[];
  status: SeatStatusFilter;
  scope: RankScope;
  companySlug: string;
  companyName: string;
  domain: number;
  roleTags: Record<number, string | null>;
  asOf: string;
}) {
  const keep = (s: CompanySeat) => status === "all" || s.seat_status === status;
  const scored = seats.filter((s) => s.in_scope && s.global_rank != null && keep(s));
  const unscored = seats.filter((s) => !(s.in_scope && s.global_rank != null) && keep(s));
  const of = seats[0]?.of ?? 0;
  const hrefFor = (s: CompanySeat) => withScope(`/c/${companySlug}/d/${s.person_slug}`, scope);
  const shown = [...scored, ...unscored];

  if (shown.length === 0) {
    return (
      <div className="px-4 sm:px-5 py-8 text-center text-[13px] leading-5 text-ink-2">
        <p>No {status === "all" ? "" : `${status} `}seats on this board yet.</p>
        {status !== "all" && (
          <Link href={withScope(`/c/${companySlug}`, scope)} scroll={false} className="mt-2 inline-block text-accent-ink hover:underline">
            Show all seats
          </Link>
        )}
      </div>
    );
  }

  const used = new Map<string, { label: string; hint: string }>();
  for (const s of shown) {
    for (const c of factChips(s, scope)) {
      if (!used.has(c.key)) {
        const generic = c.key === "exec" ? CHIP_HINT.exec(null) : CHIP_HINT.ipo(null);
        used.set(c.key, { label: c.label, hint: generic });
      }
    }
    for (const t of rowTags(s, 2)) if (!used.has(t.key)) used.set(t.key, { label: t.label, hint: t.hint });
  }

  return (
    <div>
      <p className="px-4 sm:px-5 pt-4 pb-3 text-[12px] leading-4 text-ink-3">
        Seat ranks are out of all <span className="num">{of}</span> scored seats on tracked boards · {SCOPE_LABEL[scope]}
      </p>

      {/* md and up: one table, scored rows then the Not scored group. */}
      <table data-sticky-head className="hidden md:table w-full text-[13px] leading-5 num border-t border-line">
        <caption className="sr-only">
          Board standings: {shown.length} seats on {companyName}&apos;s board. {scored.length} scored seats ranked by stock vs
          S&amp;P 500 per year, {SCOPE_LABEL[scope]}; {unscored.length} not scored.
        </caption>
        <thead>
          <tr className="text-left">
            <th scope="col" className={`${TH} pl-4 sm:pl-5 w-[92px]`} style={STICKY}>Seat rank</th>
            <th scope="col" className={TH} style={STICKY}>Director</th>
            <th scope="col" className={`${TH} hidden lg:table-cell`} style={STICKY}>Window</th>
            <th scope="col" className={`${TH} text-right`} style={STICKY}>Yrs</th>
            <th scope="col" className={TH} style={STICKY}>Per yr vs S&amp;P</th>
            <th scope="col" className={`${TH} text-right`} style={STICKY}>Stock</th>
            <th scope="col" className={`${TH} text-right ${WIDE}`} style={STICKY}>S&amp;P 500</th>
            <th scope="col" className={`${TH} text-right ${WIDE}`} style={STICKY}>Worst drop</th>
            <th scope="col" className={`${TH} pr-4 sm:pr-5`} style={STICKY}>Notes</th>
          </tr>
        </thead>
        {scored.length > 0 && (
          <tbody>
            {scored.map((s, i) => (
              <DesktopRow key={s.membership_id} s={s} i={i} href={hrefFor(s)} tag={roleTags[s.membership_id]} scope={scope}
                          domain={domain} asOf={asOf} />
            ))}
          </tbody>
        )}
        {unscored.length > 0 && (
          <tbody>
            <tr>
              <th scope="rowgroup" colSpan={9}
                  className="pl-4 sm:pl-5 pr-3 pt-5 pb-2 text-left text-[11px] leading-[14px] font-semibold uppercase tracking-[0.08em] text-ink-2 border-b border-line">
                Not scored (<span className="num">{unscored.length}</span>)
              </th>
            </tr>
            {unscored.map((s) => (
              <DesktopRow key={s.membership_id} s={s} i={99} href={hrefFor(s)} tag={roleTags[s.membership_id]} scope={scope}
                          domain={domain} asOf={asOf} />
            ))}
          </tbody>
        )}
      </table>

      {/* Below md: two-line row blocks, no horizontal scrolling. */}
      <div className="md:hidden border-t border-line">
        {scored.length > 0 && (
          <ol aria-label={`Scored seats, ${SCOPE_LABEL[scope]}`} className="divide-y divide-line">
            {scored.map((s, i) => (
              <MobileRow key={s.membership_id} s={s} i={i} href={hrefFor(s)} tag={roleTags[s.membership_id]} scope={scope}
                         domain={domain} asOf={asOf} />
            ))}
          </ol>
        )}
        {unscored.length > 0 && (
          <>
            <h3 className="px-4 pt-5 pb-2 text-[11px] leading-[14px] font-semibold uppercase tracking-[0.08em] text-ink-2 border-b border-line">
              Not scored (<span className="num">{unscored.length}</span>)
            </h3>
            <ul className="divide-y divide-line">
              {unscored.map((s) => (
                <MobileRow key={s.membership_id} s={s} i={99} href={hrefFor(s)} tag={roleTags[s.membership_id]} scope={scope}
                           domain={domain} asOf={asOf} />
              ))}
            </ul>
          </>
        )}
      </div>

      {used.size > 0 && (
        <details className="border-t border-line px-4 sm:px-5 py-3 text-[12px] leading-4">
          <summary className="cursor-pointer w-fit text-ink-3 hover:text-ink-2 min-h-6 inline-flex items-center">What the chips mean</summary>
          <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-[max-content_1fr] max-w-[80ch]">
            {[...used.entries()].map(([k, c]) => (
              <div key={k} className="contents">
                <dt><Chip kind={k === "exec" || k === "ipo" ? k : "tag"} label={c.label} /></dt>
                <dd className="text-ink-2">{c.hint}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

type RowProps = {
  s: CompanySeat; i: number; href: string; tag: string | null | undefined; scope: RankScope; domain: number; asOf: string;
};

function isScored(s: CompanySeat): boolean {
  return s.in_scope && s.global_rank != null;
}

function NameLink({ s, href, tag }: { s: CompanySeat; href: string; tag: string | null | undefined }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 min-w-0">
      <Link href={href}
            className="text-[14px] leading-5 font-semibold text-ink hover:text-accent-ink after:absolute after:inset-0 after:content-['']">
        {s.full_name}
      </Link>
      {tag && <span className="shrink-0 text-[10px] leading-3 text-ink-3 uppercase tracking-wide">{tag}</span>}
    </span>
  );
}

function StockCell({ s }: { s: CompanySeat }) {
  if (s.perf_status === "approximate" && s.return_low != null && s.return_high != null) {
    return <span className="text-ink-2">≈ <span className="whitespace-nowrap">{pct(s.return_low, 0)}</span> to <span className="whitespace-nowrap">{pct(s.return_high, 0)}</span></span>;
  }
  return <Signed value={s.total_return} kind="pct" />;
}

function DesktopRow({ s, i, href, tag, scope, domain, asOf }: RowProps) {
  const scored = isScored(s);
  const reason = scored ? null : seatReason(s, scope);
  const chips = factChips(s, scope);
  const tags = rowTags(s, 2);
  const measured = s.perf_status === "ok" || s.rank_eligible;
  return (
    <tr className={`relative border-b border-line last:border-0 hover:bg-surface-2 transition-colors ${scored ? "" : "text-ink-2"}`}>
      <td className={`${TD} pl-4 sm:pl-5 whitespace-nowrap`}>
        {scored ? <RankBadge rank={s.global_rank!} tie={s.tie} of={s.of} size="sm" /> : <span className="text-ink-3">—</span>}
      </td>
      <td className={`${TD} min-w-[180px]`}><NameLink s={s} href={href} tag={tag} /></td>
      <td className={`${TD} hidden lg:table-cell whitespace-nowrap text-ink-2`}>{seatWindowLabel(s)}</td>
      <td className={`${TD} text-right whitespace-nowrap text-ink-2`}>{seatYears(s, asOf)}</td>
      <td className={TD}>
        {scored ? (
          <span className="flex items-center gap-3">
            <span className="w-16 text-right"><Signed value={s.annualized_excess} kind="pct" /></span>
            {/* The bar drops between md and lg so the table fits without sideways scrolling. */}
            <span className="hidden lg:inline-flex">
              <ExcessBar value={s.annualized_excess} domain={domain} size="sm" animate={i < 10} delayMs={i * 15} />
            </span>
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {s.rank_eligible && <span className="w-16 text-right"><Signed value={s.annualized_excess} kind="pct" /></span>}
            {reason && <Chip kind="reason" label={reason} wrap />}
          </span>
        )}
      </td>
      <td className={`${TD} text-right`}><StockCell s={s} /></td>
      <td className={`${TD} text-right ${WIDE}`}>
        {measured ? <Signed value={s.bench_total_return} kind="pct" /> : <span className="text-ink-3">—</span>}
      </td>
      <td className={`${TD} text-right ${WIDE}`}>
        {measured ? <Signed value={s.max_drawdown} kind="pct" /> : <span className="text-ink-3">—</span>}
      </td>
      <td className={`${TD} pr-4 sm:pr-5`}>
        <span className="flex flex-wrap gap-1">
          {chips.map((c) => <Chip key={c.key} kind={c.key} label={c.label} hint={c.hint} wrap />)}
          {tags.map((t) => <Chip key={t.key} kind="tag" label={t.label} hint={t.hint} wrap />)}
        </span>
      </td>
    </tr>
  );
}

function MobileRow({ s, i, href, tag, scope, domain, asOf }: RowProps) {
  const scored = isScored(s);
  const reason = scored ? null : seatReason(s, scope);
  // At most one chip on a mobile row: the reason when unscored, else the first tag or fact.
  const chip: { kind: "reason" | "tag" | FactChip["key"]; label: string } | null = reason
    ? { kind: "reason", label: reason }
    : (() => {
        const t = rowTags(s, 1)[0];
        if (t) return { kind: "tag" as const, label: t.label };
        const f = factChips(s, scope)[0];
        return f ? { kind: f.key, label: f.label } : null;
      })();
  return (
    <li className="relative px-4 py-2.5 min-h-12">
      <div className="flex items-center gap-3">
        {scored ? (
          <RankBadge rank={s.global_rank!} tie={s.tie} of={s.of} size="sm" />
        ) : (
          <span className="inline-grid place-items-center min-w-10 h-7 rounded-md border border-dashed border-line-strong text-ink-3 shrink-0">
            <span aria-hidden>—</span><span className="sr-only">Not scored</span>
          </span>
        )}
        <span className="flex-1 min-w-0"><NameLink s={s} href={href} tag={tag} /></span>
        {s.rank_eligible && <Signed value={s.annualized_excess} kind="perYear" />}
      </div>
      <div className="mt-1.5 pl-[52px] space-y-1.5">
        <p className="text-[12px] leading-4 text-ink-3 num">
          {seatWindowLabel(s)} · {seatYears(s, asOf)} yrs
          {!s.rank_eligible && s.perf_status === "approximate" && s.return_low != null && s.return_high != null && (
            <> · stock ≈ {pct(s.return_low, 0)} to {pct(s.return_high, 0)}</>
          )}
        </p>
        {scored && <ExcessBar value={s.annualized_excess} domain={domain} size="sm" width="full" animate={i < 10} delayMs={i * 15} />}
        {chip && <div><Chip kind={chip.kind} label={chip.label} /></div>}
      </div>
    </li>
  );
}
