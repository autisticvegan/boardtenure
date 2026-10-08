import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BoardTimeline, type TimelineRow } from "@/components/board-timeline";
import { type Marker } from "@/components/return-chart";
import { BoardRecordDek } from "@/components/standings/board-record-dek";
import { BoardStandings, parseStatus, type SeatStatusFilter } from "@/components/standings/board-standings";
import { AsOf, ScopeToggle, SectionHead } from "@/components/standings/primitives";
import { SeatCallout, type CalloutKicker } from "@/components/standings/seat-callout";
import { Busy, CardSkeleton, TableSkeleton } from "@/components/standings/skeletons";
import { StockDetails, type MarketCap } from "@/components/standings/stock-details";
import { Badge, Card, Stat } from "@/components/ui";
import { compactMoney, daysBetween, fmtDate, todayIso, years } from "@/lib/format";
import {
  getBoard, getBoardEvents, getCompany, getCompanyLeaderboard, getCoverage, getDefaultBenchmark, getReturnSeries,
  getSeatRankings, type CompanyHeader, type CompanySeat, type Membership, type RankScope,
} from "@/lib/queries";
import { plainNote, shortTag } from "@/lib/roles";
import { barDomain, parseScope, seatReason, withScope } from "@/lib/standings";
import { median } from "@/lib/track-record";

// Prices are daily closes; an hour-old render is fresh enough.
export const revalidate = 3600;

export async function generateMetadata({ params }: PageProps<"/c/[slug]">): Promise<Metadata> {
  const c = await getCompany((await params).slug);
  return c
    ? { title: `${c.common_name}${c.symbol ? ` (${c.symbol})` : ""} board standings: stock vs the S&P 500 by director seat` }
    : {};
}

/** Midpoint of an imprecise start, for tenure averages only. */
function approxStart(m: Membership): string | null {
  if (!m.start_date) return null;
  if (m.start_precision === "year") return `${m.start_date.slice(0, 4)}-07-01`;
  if (m.start_precision === "month") return `${m.start_date.slice(0, 7)}-15`;
  return m.start_date;
}

const isScored = (s: CompanySeat) => s.in_scope && s.global_rank != null;

// The lookup and notFound() stay outside the Suspense boundary, so an unknown slug is a real 404;
// the header and coverage strip render first and the standings stream in behind a skeleton (§8.3).
export default async function CompanyPage({ params, searchParams }: PageProps<"/c/[slug]">) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const company = await getCompany(slug);
  if (!company) notFound();
  const scope = parseScope(sp);
  const status: SeatStatusFilter = parseStatus(sp.status);
  const coverage = await getCoverage(company.id);
  const currentCoverage = coverage.find((c) => c.scope === "current_board");
  const historyCoverage = coverage.filter((c) => c.scope === "board_history");

  return (
    <div className="space-y-8 md:space-y-12">
      <div className="space-y-4">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] leading-4 text-ink-3 mb-2">
              <Link href={withScope("/companies", scope)} className="inline-flex items-center max-md:min-h-11 hover:text-ink-2">Companies</Link>
              <span aria-hidden>/</span>
              <span aria-current="page">{company.symbol ?? company.common_name}</span>
            </nav>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-[26px] leading-8 sm:text-[32px] sm:leading-[38px] font-bold tracking-[-0.02em] text-ink">
                {company.common_name}
              </h1>
              {company.symbol && (
                <span className="font-mono text-[12px] leading-4 font-medium px-2 py-1 rounded-md bg-surface-3 border border-line-strong text-ink-2">
                  {company.exchange === "XNAS" ? "NASDAQ" : company.exchange === "XNYS" ? "NYSE" : company.exchange}: {company.symbol}
                </span>
              )}
            </div>
            <p className="text-ink-2 mt-1 text-[13px] leading-5">
              {company.legal_name}
              {company.ipo_date && company.ipo_date.slice(5) !== "01-01" && <> · Listed {fmtDate(company.ipo_date)}</>}
              {company.cik && (
                <> · <a className="hover:text-ink underline decoration-line-strong underline-offset-2"
                        href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${company.cik}`}
                        target="_blank" rel="noreferrer">SEC filings</a></>
              )}
            </p>
          </div>
          {company.last_date && <div className="sm:text-right shrink-0"><AsOf date={company.last_date} /></div>}
        </header>

        <CoverageStrip current={currentCoverage} history={historyCoverage} />
      </div>

      <Suspense fallback={<CompanySkeleton />}>
        <CompanyBody company={company} scope={scope} status={status} />
      </Suspense>
    </div>
  );
}

function CompanySkeleton() {
  return (
    <Busy label="Loading the board standings…">
      <div className="space-y-2">
        <div className="skeleton h-6 w-full max-w-[520px]" />
        <div className="skeleton h-4 w-full max-w-[380px]" />
      </div>
      <TableSkeleton rows={10} />
      <div className="grid gap-4 sm:grid-cols-2"><CardSkeleton /><CardSkeleton /></div>
      <CardSkeleton height={240} lines={1} />
    </Busy>
  );
}

async function CompanyBody({ company, scope, status }: { company: CompanyHeader; scope: RankScope; status: SeatStatusFilter }) {
  const [board, events, bench, seats, scopeSeats] = await Promise.all([
    getBoard(company.id), getBoardEvents(company.id), getDefaultBenchmark(),
    getCompanyLeaderboard(company.id, scope), getSeatRankings(scope),
  ]);
  const asOf = company.last_date ?? todayIso();
  const series = company.security_id
    ? await getReturnSeries(company.security_id, bench?.security_id ?? null, company.ipo_date ?? "1900-01-01", asOf)
    : [];

  // Bars share one symmetric domain over every scored seat in the scope, so they match /rankings.
  const domain = barDomain(scopeSeats.map((s) => s.annualized_excess));
  const scored = seats.filter(isScored); // SQL order: best first
  const beat = scored.filter((s) => (s.relative_return_pp ?? 0) > 0).length;
  const medianSeat = median(scored.map((s) => s.annualized_excess).filter((x): x is number => x != null));
  const seatHref = (personSlug: string) => withScope(`/c/${company.slug}/d/${personSlug}`, scope);
  const roleTags: Record<number, string | null> = Object.fromEntries(board.map((m) => [String(m.membership_id), shortTag(m)]));

  // Callouts: best and toughest scored seat; "Smallest beat" when every scored seat beat the S&P,
  // and the mirror, "Smallest lag", when every scored seat trailed it (none of them reads as "best").
  const allBeat = scored.every((s) => (s.relative_return_pp ?? 0) > 0);
  const allTrailed = scored.every((s) => (s.relative_return_pp ?? 0) <= 0);
  const callouts: { kicker: CalloutKicker; seat: CompanySeat }[] =
    scored.length === 0 ? []
    : scored.length === 1 ? [{ kicker: "Only scored seat", seat: scored[0] }]
    : [
        { kicker: allTrailed ? "Smallest lag" : "Best seat", seat: scored[0] },
        { kicker: allBeat ? "Smallest beat" : "Toughest seat", seat: scored[scored.length - 1] },
      ];

  // Who sat when: every seat by start date, tinted by its own scored result.
  // Keyed by string: bigint ids arrive as strings from postgres.js but as numbers inside SQL-built JSON.
  const seatById = new Map(seats.map((s) => [String(s.membership_id), s]));
  const timeline: TimelineRow[] = [...board]
    .sort((a, b) => (a.start_date ?? "9999").localeCompare(b.start_date ?? "9999"))
    .map((m) => {
      const s = seatById.get(String(m.membership_id));
      return {
        key: String(m.membership_id),
        href: seatHref(m.person_slug),
        name: m.full_name,
        status: m.status,
        start_date: m.start_date,
        start_precision: m.start_precision,
        end_date: m.end_date,
        end_precision: m.end_precision,
        tag: shortTag(m),
        excess: s?.rank_eligible ? s.annualized_excess : null,
        outOfScope: !!s && s.rank_eligible && !s.in_scope,
        reason: s ? seatReason(s, scope) : null,
        total_return: s?.total_return ?? null,
        bench_total_return: s?.bench_total_return ?? null,
      };
    });

  // The stock itself (context only).
  const fromListing = !!(company.ipo_date && series[0] && daysBetween(company.ipo_date, series[0].d) <= 7);
  const markers: Marker[] = company.ipo_date && fromListing ? [{ d: company.ipo_date, label: "IPO", kind: "ipo" }] : [];
  const marketCap: MarketCap | null = company.shares != null && company.last_close != null && company.last_date
    ? {
        value: compactMoney(company.shares * company.last_close),
        approx: company.share_classes > 1,
        close: fmtDate(company.last_date),
        note: `${company.shares.toLocaleString("en-US")} shares outstanding as of ${fmtDate(company.shares_as_of)} (10-K/10-Q cover)${company.share_classes > 1 ? "; all share classes valued at the primary listing's price" : ""}`,
      }
    : null;

  // Board overview (unchanged facts).
  const current = board.filter((m) => m.status === "current");
  const former = board.filter((m) => m.status === "former");
  const tenures = current.map(approxStart).filter((d): d is string => d != null).map((d) => daysBetween(d, todayIso()));
  const avgTenure = tenures.length ? tenures.reduce((a, b) => a + b, 0) / tenures.length : null;
  const anyImprecise = current.some((m) => m.start_precision !== "day");
  const twoYearsAgo = `${Number(todayIso().slice(0, 4)) - 2}${todayIso().slice(4)}`;
  const recentJoins = board.filter((m) => m.start_precision === "day" && m.start_date && m.start_date >= twoYearsAgo);
  const recentLeaves = former
    .filter((m) => m.end_date && m.end_date >= twoYearsAgo)
    .sort((a, b) => (b.end_date ?? "").localeCompare(a.end_date ?? ""));
  const statusHref = (s: SeatStatusFilter) => withScope(`/c/${company.slug}`, scope, { status: s === "all" ? undefined : s });

  return (
    <>
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-x-8 gap-y-4">
        <BoardRecordDek scored={scored.length} beat={beat} median={medianSeat} />
        <div className="shrink-0">
          <ScopeToggle scope={scope} hrefFor={(s) => withScope(`/c/${company.slug}`, s, { status: status === "all" ? undefined : status })} />
        </div>
      </div>

      <section aria-labelledby="board-standings" className="anim-fade" key={scope}>
        <SectionHead
          id="board-standings"
          title="Board standings"
          sub={<>Every seat on {company.common_name}&apos;s board. Scored seats first, by how the stock did against the S&amp;P 500 per year during the seat.</>}
          action={<StatusLinks status={status} hrefFor={statusHref} />}
        />
        <Card pad={false}>
          <BoardStandings
            seats={seats}
            status={status}
            scope={scope}
            companySlug={company.slug}
            companyName={company.common_name}
            domain={domain}
            roleTags={roleTags}
            asOf={asOf}
          />
        </Card>
      </section>

      {callouts.length > 0 && (
        <section aria-labelledby="callouts-head">
          <h2 id="callouts-head" className="sr-only">Best and toughest seats</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {callouts.map((c) => (
              <SeatCallout key={c.kicker} kicker={c.kicker} seat={c.seat} href={seatHref(c.seat.person_slug)} asOf={asOf} />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="who-sat-when">
        <SectionHead
          id="who-sat-when"
          title="Who sat when"
          sub="One bar per seat, tinted by how the stock did against the S&P 500 per year during it. Seats held at the same time share market conditions."
        />
        <Card>
          <BoardTimeline rows={timeline} ipoDate={company.ipo_date} asOf={asOf} />
        </Card>
      </section>

      <StockDetails
        symbol={company.symbol ?? company.common_name}
        benchLabel={bench?.name ?? null}
        since={series[0] ? fmtDate(series[0].d) : null}
        points={series}
        markers={markers}
        baseCaption={series[0] ? `Rebased to 0% at the ${fromListing ? "first close" : "earliest stored close"}, ${fmtDate(series[0].d)}` : undefined}
        marketCap={marketCap}
      />

      <div className={`grid gap-6 ${events.length > 0 ? "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" : ""} items-start`}>
        <Card title="Board overview">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 pt-1">
            <Stat label="Directors" value={current.length} sub={`${former.length} former tracked`} />
            <Stat label={`Avg tenure${anyImprecise ? " (≈)" : ""}`} value={years(avgTenure)} />
            <Stat label={`Median tenure${anyImprecise ? " (≈)" : ""}`} value={years(median(tenures))} />
            <Stat label="Independent" value={`${current.filter((m) => m.is_independent).length} / ${current.length}`}
                  sub={current.some((m) => m.is_independent == null)
                    ? `${current.filter((m) => m.is_independent == null).length} not yet determined`
                    : "per latest proxy"} />
          </div>
          <div className="mt-5 pt-4 border-t border-line space-y-3 text-[13px] leading-5">
            <MiniList title="Recent appointments" empty="None in the last two years"
              items={recentJoins.map((m) => ({ key: m.membership_id, href: seatHref(m.person_slug), name: m.full_name, date: fmtDate(m.start_date) }))} />
            <MiniList title="Recent departures" empty="None in the last two years"
              items={recentLeaves.map((m) => ({ key: m.membership_id, href: seatHref(m.person_slug), name: m.full_name, date: fmtDate(m.end_date, m.end_precision ?? "day") }))} />
          </div>
        </Card>

        {events.length > 0 && (
          <Card title="Board changes">
            <ol className="divide-y divide-line">
              {events.slice(0, 20).map((e) => (
                <li key={e.id} className="py-2.5 flex gap-4 text-[13px] leading-5">
                  <span className="w-28 shrink-0 text-ink-3 num">{fmtDate(e.event_date, e.event_date_precision)}</span>
                  <span className="min-w-0">
                    <EventLabel type={e.event_type} />{" "}
                    {e.person_slug ? (
                      <Link className="text-ink hover:underline" href={seatHref(e.person_slug)}>{e.full_name}</Link>
                    ) : null}
                    {typeof e.details?.summary === "string" && plainNote(e.details.summary) && <span className="text-ink-2"> · {plainNote(e.details.summary)}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
    </>
  );
}

function StatusLinks({ status, hrefFor }: { status: SeatStatusFilter; hrefFor: (s: SeatStatusFilter) => string }) {
  const opts: [SeatStatusFilter, string][] = [["all", "All"], ["current", "Current"], ["former", "Former"]];
  return (
    <nav aria-label="Filter seats by status" className="flex items-center text-[13px]">
      {opts.map(([s, label], i) => (
        <span key={s} className="inline-flex items-center">
          {i > 0 && <span aria-hidden className="px-1 text-ink-3">·</span>}
          <Link
            href={hrefFor(s)}
            scroll={false}
            aria-current={s === status ? "true" : undefined}
            className={`inline-grid place-items-center min-h-11 md:min-h-9 px-2 rounded-md font-semibold transition-colors ${
              s === status ? "text-ink shadow-[inset_0_-2px_0_var(--accent)]" : "text-ink-2 hover:text-ink"
            }`}
          >
            {label}
          </Link>
        </span>
      ))}
    </nav>
  );
}

function MiniList({ title, items, empty }: {
  title: string; empty: string; items: { key: number; href: string; name: string; date: string }[];
}) {
  return (
    <div>
      <div className="text-[12px] leading-4 text-ink-3 mb-1">{title}</div>
      {items.length === 0 ? <div className="text-ink-3">{empty}</div> : (
        <ul className="space-y-1">
          {items.slice(0, 4).map((i) => (
            <li key={i.key} className="flex justify-between gap-3">
              <Link href={i.href} className="truncate hover:text-accent-ink">{i.name}</Link>
              <span className="text-ink-3 num shrink-0">{i.date}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventLabel({ type }: { type: string }) {
  const map: Record<string, [string, "accent" | "neutral"]> = {
    BOARD_JOIN: ["Joined", "accent"],
    BOARD_LEAVE: ["Left", "neutral"],
    ROLE_CHANGE: ["Role change", "neutral"],
    BOARD_SIZE_CHANGE: ["Board size", "neutral"],
    COMMITTEE_CHANGE: ["Committee", "neutral"],
  };
  const [label, tone] = map[type] ?? [type, "neutral"];
  return <Badge tone={tone}>{label}</Badge>;
}

function CoverageStrip({ current, history }: {
  current: { level: string; method: string; assessed_at: string } | undefined;
  history: { level: string; period_start: string; period_end: string; method: string }[];
}) {
  // How each coverage level was established (and which past directors are missing) is shown in a
  // disclosure, never only in a title attribute (§10.23).
  const notes = [
    ...(current?.method ? [{ key: "current", label: "Current board", text: current.method }] : []),
    ...history.filter((h) => h.method).map((h) => ({
      key: h.period_start, label: `History ${h.period_start.slice(0, 4)}–${h.period_end.slice(0, 4)}`, text: h.method,
    })),
  ];
  return (
    <div className="rounded-lg border border-line bg-surface text-[12px] leading-4 text-ink-2">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
        <span className="inline-flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${current?.level === "complete" ? "bg-pos" : "bg-warn"}`} aria-hidden />
          <span className="text-ink-3">Current board</span>
          {current ? <span>{current.level === "complete" ? "Verified" : "Partial"} · checked {fmtDate(current.assessed_at.slice(0, 10))}</span> : <span>Not yet verified</span>}
        </span>
        {history.map((h) => (
          <span key={h.period_start} className="inline-flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${h.level === "complete" ? "bg-pos" : "bg-warn"}`} aria-hidden />
            <span className="text-ink-3">History {h.period_start.slice(0, 4)}–{h.period_end.slice(0, 4)}</span>
            <span className="capitalize">{h.level}</span>
          </span>
        ))}
        <Link href="/methodology" className="ml-auto inline-flex items-center max-md:min-h-11 text-ink-3 hover:text-ink-2">How we measure</Link>
      </div>
      {notes.length > 0 && (
        <details className="group border-t border-line">
          <summary className="flex items-center gap-2 cursor-pointer select-none list-none px-4 min-h-9 max-md:min-h-11 text-ink-3 hover:text-ink-2 [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="transition-transform group-open:rotate-90">›</span>
            Coverage notes
          </summary>
          <dl className="px-4 pb-3 space-y-2 max-w-[90ch]">
            {notes.map((n) => (
              <div key={n.key}>
                <dt className="text-ink-3">{n.label}</dt>
                <dd className="text-ink-2">{n.text}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}
