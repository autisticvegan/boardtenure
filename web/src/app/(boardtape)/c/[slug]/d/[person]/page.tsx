import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ReturnChart, type Marker } from "@/components/return-chart";
import { SourceList } from "@/components/source-list";
import { ScopeToggle, SectionHead, Signed } from "@/components/standings/primitives";
import { SameBoardroom } from "@/components/standings/same-boardroom";
import { SeatChips, TenureTags } from "@/components/standings/seat-chips";
import { SeatRankChips } from "@/components/standings/seat-rank-chips";
import { Busy, CardSkeleton } from "@/components/standings/skeletons";
import { firstName, SeatSummary } from "@/components/standings/seat-summary";
import { WhiteKnuckle } from "@/components/standings/white-knuckle";
import { Badge, Card, Confidence, Stat } from "@/components/ui";
import { fmtDate, money, pct, tenureLength } from "@/lib/format";
import {
  getBoard, getBoardStrips, getCompany, getDefaultBenchmark, getEvidence, getReturnSeries, getSeatRankings,
  type CompanyHeader, type Membership, type RankScope, type SeatRank, type SeatRef,
} from "@/lib/queries";
import { getPersonSeats } from "@/lib/queries-people";
import { END_REASON, plainNote, primaryRole, roleLabel } from "@/lib/roles";
import { barDomain, parseScope, SCOPE_LABEL, withScope } from "@/lib/standings";

// Prices are daily closes; a day-long cache is fresh enough for the static parts.
export const revalidate = 86400;

export async function generateMetadata({ params }: PageProps<"/c/[slug]/d/[person]">): Promise<Metadata> {
  const { slug, person } = await params;
  const company = await getCompany(slug);
  const seat = company ? (await getBoard(company.id)).find((m) => m.person_slug === person) : undefined;
  if (!company || !seat) return {};
  return { title: `${seat.full_name} on the ${company.common_name} board: ${company.symbol ?? company.common_name} vs the S&P 500` };
}

function shiftMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, Math.min(d, 28)));
  return dt.toISOString().slice(0, 10);
}

// The lookups and notFound() stay outside the Suspense boundary, so an unknown seat is a real 404;
// the header renders first and the rest streams in behind a skeleton (§8.3).
export default async function SeatPage({ params, searchParams }: PageProps<"/c/[slug]/d/[person]">) {
  const [{ slug, person }, sp] = await Promise.all([params, searchParams]);
  const scope = parseScope(sp);
  const company = await getCompany(slug);
  if (!company) notFound();
  const seats = (await getBoard(company.id)).filter((m) => m.person_slug === person);
  if (seats.length === 0) notFound();
  const name = seats[0].full_name;
  const path = `/c/${company.slug}/d/${person}`;

  return (
    <div className="space-y-8 md:space-y-12">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] leading-4 text-ink-3 mb-1.5">
            <Link href={withScope(`/c/${company.slug}`, scope)} className="inline-flex items-center max-md:min-h-11 hover:text-ink-2">{company.symbol}</Link>
            <span aria-hidden>/</span>
            <span aria-current="page">Board</span>
          </nav>
          <h1 className="text-[26px] leading-8 md:text-[32px] md:leading-[38px] font-bold tracking-[-0.02em] text-ink">
            {name}
            <span className="text-ink-3 font-normal"> on the {company.common_name} board</span>
          </h1>
          <p className="mt-1 text-[13px] leading-5">
            <Link href={withScope(`/d/${person}`, scope)} className="inline-flex items-center max-md:min-h-11 text-accent-ink hover:underline">{name}&rsquo;s director page →</Link>
          </p>
        </div>
        <div className="w-full sm:w-auto sm:shrink-0">
          <ScopeToggle scope={scope} hrefFor={(s) => withScope(path, s)} />
        </div>
      </header>

      <Suspense fallback={<SeatSkeleton />}>
        <SeatBody company={company} seats={seats} person={person} scope={scope} path={path} />
      </Suspense>
    </div>
  );
}

function SeatSkeleton() {
  return (
    <Busy label="Loading this seat…">
      <CardSkeleton height={120} lines={3} />
      <CardSkeleton height={280} lines={1} />
      <CardSkeleton height={36} lines={1} />
    </Busy>
  );
}

async function SeatBody({ company, seats, person, scope, path }: {
  company: CompanyHeader; seats: Membership[]; person: string; scope: RankScope; path: string;
}) {
  const os: RankScope = scope === "all" ? "independent" : "all";
  // Bare bigint columns arrive as strings and JSON-built ones as numbers; compare as numbers.
  const ids = seats.map((s) => Number(s.membership_id));
  const [bench, evidence, refs, strips, seatRanks, otherRanks] = await Promise.all([
    getDefaultBenchmark(),
    getEvidence("board_membership", ids),
    getPersonSeats(seats[0].person_id, scope),
    getBoardStrips(scope),
    getSeatRankings(scope),
    getSeatRankings(os),
  ]);

  const first = firstName(seats[0].full_name);
  const sym = company.symbol ?? company.common_name;
  const refById = new Map(refs.map((r) => [Number(r.membership_id), r]));
  const strip = strips.find((r) => r.slug === company.slug);
  // The strip's one symmetric domain, over every scored seat in the scope (filters never rescale it).
  const domain = barDomain(seatRanks.map((s) => s.annualized_excess));
  const otherSeats = refs.filter((r) => r.company_slug !== company.slug);
  const ringed = strip ? strip.seats.some((s) => ids.includes(Number(s.membership_id))) : false;

  return (
    <>
      {await Promise.all(seats.map(async (m, i) => (
        <SeatBlock
          key={m.membership_id}
          m={m}
          index={seats.length > 1 ? { i, n: seats.length } : null}
          company={company}
          sym={sym}
          scope={scope}
          path={path}
          seatRef={refById.get(Number(m.membership_id)) ?? null}
          rank={seatRanks.find((s) => Number(s.membership_id) === Number(m.membership_id)) ?? null}
          otherRank={otherRanks.find((s) => Number(s.membership_id) === Number(m.membership_id)) ?? null}
          benchName={bench?.name ?? "S&P 500 (SPY)"}
          benchSecurityId={bench?.security_id ?? null}
        />
      )))}

      {strip && strip.scored > 0 && (
        <section aria-labelledby="same-boardroom">
          <SectionHead id="same-boardroom" title="Same boardroom"
                       sub="Board-mates' seats on the same scale. Overlapping years land close together." />
          <Card pad={false}>
            <div className="p-4 sm:p-5 space-y-3">
              <SameBoardroom row={strip} highlight={ids} scope={scope} domain={domain} />
              {!ringed && (
                <p className="text-[12px] leading-4 text-ink-3">
                  This seat isn&rsquo;t scored with {SCOPE_LABEL[scope]}, so it isn&rsquo;t on the strip.
                </p>
              )}
            </div>
          </Card>
        </section>
      )}

      {otherSeats.length > 0 && (
        <section aria-labelledby="other-seats">
          <SectionHead id="other-seats" title={`${first}’s other seats`} />
          <SeatChips seats={otherSeats} personSlug={person} scope={scope} />
        </section>
      )}

      <Card title="Sources">
        <SourceList rows={evidence} />
      </Card>

      {seats.map((m) => <MeasuredAndRoles key={m.membership_id} m={m} multi={seats.length > 1} />)}
    </>
  );
}

async function SeatBlock({ m, index, company, sym, scope, path, seatRef, rank, otherRank, benchName, benchSecurityId }: {
  m: Membership;
  index: { i: number; n: number } | null;
  company: CompanyHeader;
  sym: string;
  scope: RankScope;
  path: string;
  seatRef: SeatRef | null;
  rank: SeatRank | null;
  otherRank: SeatRank | null;
  benchName: string;
  benchSecurityId: number | null;
}) {
  const p = m.perf;
  const current = m.status === "current";
  const anchorStart = p?.start_anchor_date ?? company.ipo_date ?? m.start_date;
  const anchorEnd = p?.end_anchor_date ?? company.last_date;
  const from = anchorStart && company.ipo_date
    ? [shiftMonths(anchorStart, -6), company.ipo_date].sort().at(-1)!
    : anchorStart;
  const to = anchorEnd && company.last_date ? [shiftMonths(anchorEnd, 6), company.last_date].sort()[0] : anchorEnd;
  const series = company.security_id && from && to && anchorStart
    ? await getReturnSeries(company.security_id, benchSecurityId, from, to, {
        baseDate: anchorStart, keep: [anchorStart, anchorEnd].filter(Boolean) as string[],
      })
    : [];
  const markers: Marker[] = [];
  if (p?.start_anchor_date) {
    markers.push({ d: p.start_anchor_date, kind: "join", label: p.start_anchor_reason === "first_trade" ? "IPO (joined earlier)" : "Joined" });
  }
  if (p?.end_anchor_date && m.status === "former") markers.push({ d: p.end_anchor_date, kind: "leave", label: "Left" });

  const period = `${fmtDate(m.start_date, m.start_precision)} – ${current ? "present" : fmtDate(m.end_date, m.end_precision ?? "unknown")}`;
  const excess = seatRef?.annualized_excess ?? null;
  const ok = p?.status === "ok";

  return (
    <section aria-label={index ? `Seat ${index.i + 1} of ${index.n}` : "This seat"} className="space-y-6">
      {index && (
        <h2 className="text-[20px] leading-[26px] font-bold tracking-[-0.01em] text-ink">
          Seat {index.i + 1} of {index.n} <span className="text-ink-3 font-normal num">· {period}</span>
        </h2>
      )}
      <Card pad={false}>
        <div className="p-4 sm:p-5 space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-[12px] leading-4 text-ink-3">
            <Badge tone={current ? "accent" : "neutral"}>{current ? "Current director" : "Former director"}</Badge>
            <span>{primaryRole(m, current)}</span>
            <span aria-hidden>·</span>
            <span className="num">{period}</span>
            <span aria-hidden>·</span>
            <span>{tenureLength(m.start_date, m.end_date, m.start_precision)}</span>
            <span className="ml-auto"><Confidence level={m.confidence} /></span>
          </div>

          <SeatRankChips seat={seatRef} rank={rank} otherRank={otherRank} scope={scope} href={path} />

          <p className="text-[15px] leading-6 text-ink-2 max-w-[72ch]">
            <SeatSummary name={m.full_name} company={company.common_name} sym={sym} perf={p} excess={excess}
                         current={current} start={m.start_date} end={m.end_date}
                         startPrecision={m.start_precision} endPrecision={m.end_precision} />
          </p>

          {ok && (
            <div className="grid gap-x-8 gap-y-5 lg:grid-cols-[auto_minmax(0,1fr)] pt-1">
              <div className="min-w-0">
                <div className="text-[12px] leading-4 text-ink-3">Per year vs S&amp;P 500</div>
                <div className="mt-1"><Signed value={excess} glyph size="xl" /></div>
                <div className="mt-1 text-[12px] leading-4 text-ink-3">
                  {excess == null ? "Not annualized under 1 year" : `${sym} vs the S&P 500, per year during the seat`}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5 lg:border-l lg:border-line lg:pl-8 content-start">
                <Stat label={`${sym} total return`} value={<Signed value={p.total_return} kind="pct" />} />
                <Stat label="S&P 500 total return" value={<Signed value={p.bench_total_return} kind="pct" />} />
                <Stat label="Difference" value={<Signed value={p.relative_return_pp} kind="pp" />} sub="percentage points" />
                <Stat label={`${sym} per year`} value={<Signed value={p.annualized_return} kind="perYear" />}
                      sub={p.annualized_return == null ? "under one year" : `S&P 500 ${pct(p.bench_annualized_return)}/yr`} />
                <div className="col-span-2 sm:col-span-1">
                  <WhiteKnuckle mdd={p.max_drawdown} peak={p.mdd_peak_date} trough={p.mdd_trough_date}
                                beat={(p.relative_return_pp ?? 0) > 0} />
                </div>
              </div>
            </div>
          )}
          {p?.status === "approximate" && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
              <Stat label={`${sym} total return`}
                    value={<span className="text-ink-2 num">≈ {pct(p.return_low, 0)} to {pct(p.return_high, 0)}</span>}
                    sub="range: a seat date is imprecise" />
            </div>
          )}

          {seatRef?.rank_eligible && <TenureTags seat={seatRef} sym={sym} />}
        </div>
      </Card>

      {/* No chart for a seat with no stock window (ended before listing, or dates unknown). */}
      {series.length > 1 && p?.status !== "no_price_history" && p?.status !== "unknown_dates" && (
        <Card title="Stock performance during tenure">
          <ReturnChart
            points={series}
            stockLabel={sym}
            benchLabel={benchName}
            band={p?.start_anchor_date ? { from: p.start_anchor_date, to: p.end_anchor_date ?? series.at(-1)!.d } : undefined}
            markers={markers}
            height={340}
            baseCaption={p?.start_anchor_date ? `Rebased to 0% at the ${fmtDate(p.start_anchor_date)} close` : undefined}
          />
        </Card>
      )}
    </section>
  );
}

function MeasuredAndRoles({ m, multi }: { m: Membership; multi: boolean }) {
  const p = m.perf;
  const suffix = multi ? ` · ${fmtDate(m.start_date, m.start_precision)} seat` : "";
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title={`How this was measured${suffix}`}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px] leading-5">
          <dt className="text-ink-3">Joined</dt>
          <dd>{fmtDate(m.start_date, m.start_precision)} <span className="text-ink-3">· {plainNote(m.start_basis) ?? "basis not recorded"}</span></dd>
          {m.status === "former" && <>
            <dt className="text-ink-3">Left</dt>
            <dd>{fmtDate(m.end_date, m.end_precision ?? "unknown")}{m.end_reason && <span className="text-ink-3"> · {END_REASON[m.end_reason]}</span>}</dd>
          </>}
          <dt className="text-ink-3">Start anchor</dt>
          <dd className="num">{p?.start_anchor_date ? `${fmtDate(p.start_anchor_date)} close ${money(p.start_close)}` : "—"}
            <span className="text-ink-3"> · {anchorNote(p?.start_anchor_reason)}</span></dd>
          <dt className="text-ink-3">End anchor</dt>
          <dd className="num">{p?.end_anchor_date ? `${fmtDate(p.end_anchor_date)} close ${money(p.end_close)}` : "—"}
            <span className="text-ink-3"> · {anchorNote(p?.end_anchor_reason)}</span></dd>
          {p?.start_close != null && p.end_close != null && <>
            <dt className="text-ink-3">Price at start → end</dt>
            <dd className="num">{money(p.start_close)} → {money(p.end_close)} <span className="text-ink-3">· unadjusted closes</span></dd>
          </>}
          <dt className="text-ink-3">Trading days</dt>
          <dd className="num">{p?.trading_days ?? "—"}</dd>
          <dt className="text-ink-3">Returns</dt>
          <dd>Total return with dividends reinvested, for both the stock and SPY</dd>
          <dt className="text-ink-3">Method</dt>
          <dd><Link href="/methodology" className="text-accent-ink underline decoration-line-strong underline-offset-2 hover:decoration-current">v{p?.methodology_version ?? "—"}</Link>
            {p?.data_through && <span className="text-ink-3"> · daily closes through {fmtDate(p.data_through)}</span>}</dd>
        </dl>
      </Card>
      <Card title={`Roles & committees${suffix}`}>
        {m.roles.length === 0 && m.committees.length === 0 && <p className="text-[13px] text-ink-3">No leadership roles or committee assignments recorded.</p>}
        {m.roles.length > 0 && (
          <ul className="space-y-1.5 text-[13px] mb-3">
            {m.roles.map((r, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span>{roleLabel(r)}</span>
                <span className="text-ink-3 num">{fmtDate(r.start_date, r.start_precision)} – {r.is_current ? "present" : fmtDate(r.end_date, r.end_precision ?? "unknown")}</span>
              </li>
            ))}
          </ul>
        )}
        {m.committees.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {m.committees.map((c) => (
              <Badge key={c.committee}>{c.committee.replace(/_/g, " ")}{c.role === "chair" ? " (chair)" : ""}</Badge>
            ))}
            <span className="text-[12px] text-ink-3 self-center">per latest proxy statement</span>
          </div>
        )}
      </Card>
    </div>
  );
}

function anchorNote(reason: string | null | undefined): string {
  switch (reason) {
    case "join_date": return "last close on or before the join date";
    case "first_trade": return "joined before listing; measured from the first trading day";
    case "join_window": return "join date known only to a window";
    case "leave_date": return "last close on or before the departure date";
    case "latest_close": return "latest available close (still serving)";
    case "last_trade": return "last trading day";
    case "leave_window": return "departure known only to a window";
    default: return "not measurable";
  }
}
