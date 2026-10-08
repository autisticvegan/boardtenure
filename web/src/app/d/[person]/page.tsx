import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChipKey } from "@/components/standings/chip-key";
import { DistributionDots, type DistPoint } from "@/components/standings/distribution-dots";
import { RankHero } from "@/components/standings/rank-hero";
import { SeatBars, type SeatBarRow, type UnscoredBarRow } from "@/components/standings/seat-bars";
import { firstName } from "@/components/standings/seat-summary";
import { Chip, SectionHead, Signed } from "@/components/standings/primitives";
import { Busy, CardSkeleton, TableSkeleton } from "@/components/standings/skeletons";
import { Card, Confidence, Relative, TenureReturn, Annualized } from "@/components/ui";
import { fmtDate, pct, tenureLength, type Precision } from "@/lib/format";
import {
  getCareer, getDataThrough, getDefaultBenchmark, getDirectorRank, getDirectorRankings, getLeaderboardStats, getOtherBoards,
  getPerson,
  type CareerSeat, type PersonHeader, type RankScope, type SeatRef,
} from "@/lib/queries";
import { getPersonSeats } from "@/lib/queries-people";
import { primaryRole } from "@/lib/roles";
import { barDomain, CHIP_HINT, parseScope, seatReason, seatWindow, withScope, years } from "@/lib/standings";

// Prices are daily closes; a day-long cache is fresh enough for the static parts.
export const revalidate = 86400;

export async function generateMetadata({ params }: PageProps<"/d/[person]">): Promise<Metadata> {
  const p = await getPerson((await params).person);
  return p ? { title: `${p.full_name}: board seats and stock vs the S&P 500` } : {};
}

/** "Mar 2019 – present" at the precision each date is known to. */
function datesWindow(s: { start_date: string | null; start_precision: Precision; end_date: string | null; end_precision: Precision | null }, current: boolean): string {
  const f = (iso: string | null, p: Precision | null) => fmtDate(iso, p === "day" ? "month" : (p ?? "unknown"));
  return `${f(s.start_date, s.start_precision)} – ${current ? "present" : f(s.end_date, s.end_precision)}`;
}

// The lookup and notFound() stay outside the Suspense boundary, so an unknown slug is a real 404;
// the rest streams in behind a skeleton (§8.3).
export default async function DirectorPage({ params, searchParams }: PageProps<"/d/[person]">) {
  const [{ person: slug }, sp] = await Promise.all([params, searchParams]);
  const scope = parseScope(sp);
  const person = await getPerson(slug);
  if (!person) notFound();
  return (
    <Suspense fallback={<DirectorSkeleton name={person.full_name} />}>
      <DirectorBody person={person} scope={scope} />
    </Suspense>
  );
}

function DirectorSkeleton({ name }: { name: string }) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] leading-[14px] font-semibold uppercase tracking-[0.08em] text-ink-3">Director</p>
        <h1 className="mt-1.5 text-[26px] leading-8 md:text-[32px] md:leading-[38px] font-bold tracking-[-0.02em] text-ink">{name}</h1>
      </div>
      <Busy label={`Loading ${name}’s standing…`}>
        <CardSkeleton height={56} />
        <CardSkeleton height={120} lines={1} />
        <TableSkeleton rows={4} />
      </Busy>
    </div>
  );
}

async function DirectorBody({ person, scope }: { person: PersonHeader; scope: RankScope }) {
  const [career, bench, otherBoards, standing, seats, rankings, dataThrough, stats] = await Promise.all([
    getCareer(person.id), getDefaultBenchmark(), getOtherBoards(person.id), getDirectorRank(person.id),
    getPersonSeats(person.id, scope), getDirectorRankings(scope), getDataThrough(), getLeaderboardStats(scope),
  ]);
  const ranked = scope === "all" ? standing.all : standing.independent;
  const other = scope === "all" ? standing.independent : standing.all;
  // One symmetric domain for every bar and dot on the page, over the whole active scope.
  const domain = barDomain(rankings.map((d) => d.score));

  const trackedSlugs = new Set(career.map((s) => s.company_slug));
  const untracked = otherBoards.filter((b) => !b.tracked_slug || !trackedSlugs.has(b.tracked_slug));
  const benchName = bench?.name ?? "S&P 500 (SPY)";
  const currentAff = person.affiliations.find((a) => a.is_current);
  const seatHref = (s: { company_slug: string }) => withScope(`/c/${s.company_slug}/d/${person.slug}`, scope);

  const bars: SeatBarRow[] = seats
    .filter((s) => s.rank_eligible && s.annualized_excess != null)
    .map((s) => {
      const current = s.seat_status === "current";
      const window = seatWindow(s.start_anchor_date, s.end_anchor_date, current);
      return {
        key: String(s.membership_id),
        href: seatHref(s),
        label: s.company_name,
        symbol: s.symbol ?? "",
        window,
        sub: `${window} · ${years(s.calendar_days ?? 0)} yrs`,
        excess: s.annualized_excess!,
        total: s.total_return,
        bench: s.bench_total_return,
        days: s.calendar_days,
        mdd: s.max_drawdown,
        mddPeak: s.mdd_peak_date,
        mddTrough: s.mdd_trough_date,
        exec: s.executive_seat,
        ipo: s.start_anchor_reason === "first_trade",
        hollow: !s.in_scope,
      };
    });
  const unscored: UnscoredBarRow[] = seats
    .filter((s) => !s.rank_eligible || s.annualized_excess == null)
    .map((s) => ({
      key: String(s.membership_id),
      href: seatHref(s),
      label: s.company_name,
      symbol: s.symbol ?? "",
      sub: datesWindow(s, s.seat_status === "current"),
      reason: seatReason(s, scope) ?? "Not scored",
      range: s.perf_status === "approximate" && s.return_low != null && s.return_high != null
        ? `≈ ${pct(s.return_low, 0)} to ${pct(s.return_high, 0)}`
        : null,
    }));
  // Bare bigint columns (getCareer) arrive as strings; key by number.
  // Every ranked director in the scope, in SQL rank order; this person is the highlight.
  const points: DistPoint[] = ranked
    ? rankings.map((d) => ({
        slug: d.slug,
        name: d.full_name,
        href: withScope(`/d/${d.slug}`, scope),
        score: d.score,
        rank: d.rank,
        tie: d.tie,
        scored_seats: d.scored_seats,
        scored_years: d.scored_years,
        tickers: [...new Set(d.companies.filter((c) => c.in_scope).map((c) => c.symbol ?? c.company_name))],
        hollow: scope === "all" && d.scored_executive_seat,
      }))
    : [];
  const seatById = new Map(seats.map((s) => [Number(s.membership_id), s]));

  return (
    <div className="space-y-8 md:space-y-12">
      <RankHero
        person={person}
        ranked={ranked}
        other={other}
        scope={scope}
        seats={seats}
        dataThrough={dataThrough}
        meta={(currentAff || person.sec_cik) && (
          <p className="mt-1 text-[13px] leading-5 text-ink-2">
            {currentAff && <>{currentAff.title ? `${currentAff.title}, ` : ""}{currentAff.organization_name}</>}
            {person.sec_cik && (
              <>{currentAff ? " · " : ""}<a className="hover:text-ink underline decoration-line-strong underline-offset-2"
                   href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${person.sec_cik}&type=&dateb=&owner=only`}
                   target="_blank" rel="noreferrer">SEC insider filings</a></>
            )}
          </p>
        )}
      />

      {(bars.length > 0 || unscored.length > 0) && (
        <section aria-labelledby="seat-by-seat">
          <SectionHead id="seat-by-seat" title="Seat by seat" sub="Per year vs the S&P 500 during each seat. One scale for all seats." />
          <Card pad={false}>
            <div className="p-3 sm:p-4">
              <SeatBars rows={bars} unscored={unscored} domain={domain} />
            </div>
          </Card>
        </section>
      )}

      {ranked && points.length > 0 && (
        <section aria-labelledby="where-lands">
          <SectionHead
            id="where-lands"
            title={`Where ${firstName(person.full_name)} lands`}
            sub="Each dot is one ranked director. Right of the line, the stock beat the S&P 500 per year during their seats."
            action={<Link href={withScope("/rankings", scope)} className="hover:text-accent-ink">See it as a table →</Link>}
          />
          <Card pad={false}>
            <div className="p-4 sm:p-5">
              <DistributionDots points={points} domain={domain} median={stats.median_score} of={ranked.of}
                                highlight={person.slug} height={160} showHollow={scope === "all"} />
            </div>
          </Card>
        </section>
      )}

      <section aria-labelledby="board-seats">
        <SectionHead id="board-seats" title="Board seats" action={<span className="text-ink-3">Benchmark: {benchName}</span>} />
        <Card pad={false}>
          <CareerTable career={career} seatById={seatById} name={person.full_name} hrefFor={seatHref} />
        </Card>
        <div className="mt-3"><ChipKey /></div>
      </section>

      {untracked.length > 0 && (
        <section aria-labelledby="other-boards">
          <SectionHead id="other-boards" title="Other public boards named in proxy biographies"
                       action={<span className="text-ink-3">not yet tracked · unverified</span>} />
          <Card pad={false}>
            <div className="p-4 sm:p-5">
              <ul className="divide-y divide-line text-[13px]">
                {untracked.map((b) => (
                  <li key={b.company} className="py-2 first:pt-0 flex flex-wrap justify-between gap-3">
                    <span className="text-ink">{b.company}</span>
                    <span className="text-ink-3">{b.status === "current" ? "Current" : "Former"}{b.years && !b.years.startsWith("not stated") ? ` · ${b.years}` : ""} · per {b.source_company} proxy</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12px] leading-4 text-ink-3">Listed as disclosed in the company&rsquo;s proxy statement. These seats aren&rsquo;t in the standings until we verify them from that company&rsquo;s own filings.</p>
            </div>
          </Card>
        </section>
      )}

      <section aria-labelledby="reading">
        <SectionHead id="reading" title="Reading these numbers" />
        <Card pad={false}>
          <ul className="list-disc pl-9 pr-5 py-4 sm:py-5 space-y-1.5 text-[13px] leading-5 text-ink-2 max-w-[680px]">
            <li>Each figure is what the company&rsquo;s stock did while this person held the seat. Boards act as groups.</li>
            <li>Seats held at the same time share market conditions.</li>
            <li>Coverage is only as complete as the companies we track.</li>
          </ul>
        </Card>
      </section>
    </div>
  );
}

const TH = "px-3 py-2.5 text-[11px] leading-[14px] font-semibold uppercase tracking-[0.08em] text-ink-3 whitespace-nowrap";
// Columns that only fit from 1200px; between lg and 1200 the table would push the page sideways.
const WIDE = "hidden min-[1200px]:table-cell";

function CareerTable({ career, seatById, name, hrefFor }: {
  career: CareerSeat[]; seatById: Map<number, SeatRef>; name: string; hrefFor: (s: { company_slug: string }) => string;
}) {
  return (
    <>
      <table className="hidden lg:table w-full text-[13px] leading-5">
        <caption className="sr-only">Board seats held by {name}, with the stock&rsquo;s return during each seat</caption>
        <thead>
          <tr className="text-left border-b border-line">
            <th scope="col" className={`${TH} pl-5`}>Company</th>
            <th scope="col" className={TH}>Role</th>
            <th scope="col" className={TH}>Joined</th>
            <th scope="col" className={TH}>Left</th>
            <th scope="col" className={TH}>Tenure</th>
            <th scope="col" className={`${TH} text-right`}>Return</th>
            <th scope="col" className={`${TH} text-right ${WIDE}`}>Annualized</th>
            <th scope="col" className={`${TH} text-right`}>vs S&amp;P 500</th>
            <th scope="col" className={`${TH} text-right max-[1199px]:pr-5`}>Per yr vs S&amp;P</th>
            <th scope="col" className={`${TH} pr-5 text-right ${WIDE}`}>Confidence</th>
          </tr>
        </thead>
        <tbody className="num">
          {career.map((s) => {
            const current = s.status === "current";
            const ref = seatById.get(Number(s.membership_id));
            return (
              <tr key={s.membership_id} className="relative h-11 border-b border-line last:border-0 hover:bg-surface-2 transition-colors">
                <td className="pl-5 pr-3 py-2.5">
                  <Link href={hrefFor(s)} className="font-medium text-ink hover:text-accent-ink after:absolute after:inset-0">
                    {s.company_name}
                  </Link>
                  {s.symbol && <span className="ml-2 font-mono text-[11px] text-ink-3">{s.symbol}</span>}
                </td>
                <td className="px-3 py-2.5 text-ink-2">{primaryRole(s, current)}</td>
                <td className="px-3 py-2.5 text-ink-2 whitespace-nowrap">
                  {fmtDate(s.start_date, s.start_precision)}
                  {s.perf?.start_anchor_reason === "first_trade" && (
                    <span className="ml-1.5"><Chip kind="ipo" label="From IPO" hint={CHIP_HINT.ipo(s.perf.start_anchor_date)} /></span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-ink-2 whitespace-nowrap">
                  {current ? <Chip kind="current" label="Current" hint={CHIP_HINT.current} /> : fmtDate(s.end_date, s.end_precision ?? "unknown")}
                </td>
                <td className="px-3 py-2.5 text-ink-2 whitespace-nowrap">{tenureLength(s.start_date, s.end_date, s.start_precision)}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap"><TenureReturn perf={s.perf} /></td>
                <td className={`px-3 py-2.5 text-right ${WIDE}`}><Annualized perf={s.perf} /></td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap"><Relative perf={s.perf} /></td>
                <td className="px-3 py-2.5 text-right max-[1199px]:pr-5"><Signed value={ref?.annualized_excess ?? null} kind="pct" /></td>
                <td className={`pl-3 pr-5 py-2.5 text-right ${WIDE}`}><Confidence level={s.confidence} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <ul className="lg:hidden divide-y divide-line" aria-label={`Board seats held by ${name}`}>
        {career.map((s) => {
          const current = s.status === "current";
          const ref = seatById.get(Number(s.membership_id));
          return (
            <li key={s.membership_id} className="relative min-h-12 px-4 py-3 hover:bg-surface-2 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <Link href={hrefFor(s)} className="min-w-0 font-medium text-[14px] leading-5 text-ink after:absolute after:inset-0">
                  {s.company_name}
                  {s.symbol && <span className="ml-2 font-mono text-[11px] text-ink-3">{s.symbol}</span>}
                </Link>
                <span className="shrink-0 text-[13px] leading-5">
                  {ref?.annualized_excess != null
                    ? <><Signed value={ref.annualized_excess} /><span className="sr-only"> vs the S&amp;P 500</span></>
                    : <TenureReturn perf={s.perf} />}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] leading-4 text-ink-3 num">
                {primaryRole(s, current)} · {fmtDate(s.start_date, s.start_precision)} – {current ? "present" : fmtDate(s.end_date, s.end_precision ?? "unknown")} · {tenureLength(s.start_date, s.end_date, s.start_precision)}
              </p>
              {s.perf?.status === "ok" && (
                <p className="mt-0.5 text-[12px] leading-4 text-ink-2 num">
                  Stock <TenureReturn perf={s.perf} /> · vs S&amp;P 500 <Relative perf={s.perf} />
                </p>
              )}
              {(current || s.perf?.start_anchor_reason === "first_trade") && (
                <p className="mt-1.5 flex flex-wrap gap-1.5">
                  {current && <Chip kind="current" label="Current" hint={CHIP_HINT.current} />}
                  {s.perf?.start_anchor_reason === "first_trade" && <Chip kind="ipo" label="From IPO" hint={CHIP_HINT.ipo(s.perf.start_anchor_date)} />}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
