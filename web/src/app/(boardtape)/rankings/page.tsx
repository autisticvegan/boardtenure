import type { Metadata } from "next";
import Link from "next/link";
import { ChipKey } from "@/components/standings/chip-key";
import { DirectorsTable } from "@/components/standings/directors-table";
import { BusyRegion, FilterBar, RankingsShell, SortSelect } from "@/components/standings/filter-bar";
import { AsOf } from "@/components/standings/primitives";
import {
  clearHref, filterDirectors, filterSeats, isFiltered, nameMatcher, parseRankingsQuery, sortDirectors, sortSeats,
} from "@/components/standings/rankings-query";
import { SeatsTable } from "@/components/standings/seats-table";
import { NotScoredList, UnrankedList, type UnscoredSeat } from "@/components/standings/unranked-list";
import {
  getDirectorRankings, getLeaderboardStats, getSeatRankings, getUnranked, listCompanies, type RankScope,
} from "@/lib/queries";
import { barDomain, SCOPE_LABEL, SCOPE_NOTE, seatReason, withScope } from "@/lib/standings";

export const metadata: Metadata = { title: "Full standings" };

/** /rankings: the full Standings table (docs/design/rankings-ui.md §4.2). Dynamic: reads searchParams. */
export default async function RankingsPage(props: PageProps<"/rankings">) {
  const query = parseRankingsQuery(await props.searchParams);
  const { scope, tab } = query;
  const [directors, seatRanks, unranked, stats, companyList] = await Promise.all([
    getDirectorRankings(scope),
    tab === "seats" ? getSeatRankings(scope) : Promise.resolve([]),
    getUnranked(scope),
    getLeaderboardStats(scope),
    listCompanies(),
  ]);

  const companies = companyList
    .map((c) => ({ slug: c.slug, symbol: c.symbol, name: c.common_name }))
    .sort((a, b) => (a.symbol ?? a.name).localeCompare(b.symbol ?? b.name));
  const known = new Set(companies.map((c) => c.slug));
  const q = { ...query, co: query.co.filter((s) => known.has(s)) };
  const filtered = isFiltered(q);
  const byName = nameMatcher(q.q);
  const co = new Set(q.co);

  // Bars share one domain over the whole active scope, so filtering never rescales them.
  const directorDomain = barDomain(directors.map((d) => d.score));
  const seatDomain = barDomain(seatRanks.map((s) => s.annualized_excess));

  const directorRows = tab === "directors" ? sortDirectors(filterDirectors(directors, q), q.sort, q.dir) : [];
  const seatRows = tab === "seats" ? sortSeats(filterSeats(seatRanks, q), q.sort, q.dir) : [];
  const of = tab === "directors" ? directors.length : seatRanks.length;
  const shown = tab === "directors" ? directorRows.length : seatRows.length;
  const noun = tab === "directors" ? "ranked directors" : "scored seats";

  // Unranked people / unscored seats honour the identity filters (name, company) too.
  const unrankedRows = unranked.filter((p) => byName(p.full_name) && (co.size === 0 || p.seats.some((s) => co.has(s.company_slug))));
  const unscored: UnscoredSeat[] = tab === "seats"
    ? [
        ...directors.flatMap((d) => d.companies.map((s) => ({ ...s, person_slug: d.slug, full_name: d.full_name }))),
        ...unranked.flatMap((p) => p.seats.map((s) => ({ ...s, person_slug: p.slug, full_name: p.full_name }))),
      ].filter((s) => seatReason(s, scope) != null)
    : [];
  const unscoredRows = unscored
    .filter((s) => byName(s.full_name) && (co.size === 0 || co.has(s.company_slug)) && (q.status === "all" || s.seat_status === q.status))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-[26px] leading-8 md:text-[32px] md:leading-[38px] font-bold tracking-[-0.02em] text-ink">Standings</h1>
        <p className="text-[16px] leading-6 text-ink-2 max-w-[68ch]">
          Ranked by how the stock did against the S&amp;P 500 per year during each seat. Ranks stay out of everyone
          ranked, even when you filter.
        </p>
        {stats.data_through && <AsOf date={stats.data_through} />}
      </header>

      <RankingsShell>
        <FilterBar query={q} companies={companies} />
        <BusyRegion className="mt-4 space-y-6">
          {/* The result line stays mounted across scope and tab changes, so its live region announces them. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="space-y-0.5">
              <p className="text-[13px] leading-5 text-ink-2 num" aria-live="polite">
                {filtered
                  ? <>Showing <strong className="text-ink">{shown}</strong> of {of} {noun}. Ranks are out of all {of}.</>
                  : <><strong className="text-ink">{of}</strong> {noun} · {SCOPE_LABEL[scope]}</>}
              </p>
              <p className="text-[12px] leading-4 text-ink-3 max-w-[68ch]">{SCOPE_NOTE[scope]}</p>
            </div>
            {shown > 1 && <SortSelect query={q} className="md:hidden" />}
          </div>
          <div key={`${scope}-${tab}`} className="anim-fade space-y-6">
            {shown === 0 ? (
              <EmptyState filtered={filtered} tab={tab} href={clearHref(q)} scope={scope} />
            ) : tab === "directors" ? (
              <DirectorsTable rows={directorRows} of={of} domain={directorDomain} scope={scope} query={q} filtered={filtered} />
            ) : (
              <SeatsTable rows={seatRows} of={of} domain={seatDomain} scope={scope} query={q} filtered={filtered} />
            )}

            <ChipKey headingLevel={2} />
            {tab === "directors"
              ? <UnrankedList people={unrankedRows} total={unranked.length} scope={scope} dataThrough={stats.data_through} />
              : <NotScoredList seats={unscoredRows} total={unscored.length} scope={scope} />}
          </div>
        </BusyRegion>
      </RankingsShell>
    </div>
  );
}

function EmptyState({ filtered, tab, href, scope }: { filtered: boolean; tab: "directors" | "seats"; href: string; scope: RankScope }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface px-5 py-10 text-center">
      {filtered ? (
        <>
          <p className="text-[15px] leading-5 font-semibold text-ink">
            {tab === "directors" ? "No directors match these filters." : "No seats match these filters."}
          </p>
          <Link href={href} data-nav="replace" scroll={false}
                className="mt-3 inline-flex items-center min-h-11 text-[13px] font-semibold text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-accent-ink">
            Clear filters
          </Link>
        </>
      ) : (
        <>
          <p className="text-[15px] leading-5 font-semibold text-ink">
            The standings fill in once directors have 2 scored years. A seat is scored after a year of exact dates.
          </p>
          <Link href={withScope("/companies", scope)} className="mt-3 inline-flex items-center min-h-11 text-[13px] font-semibold text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-accent-ink">
            Browse companies →
          </Link>
        </>
      )}
    </div>
  );
}
