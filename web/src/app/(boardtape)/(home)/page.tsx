import type { Metadata } from "next";
import Link from "next/link";
import { BoardStrips } from "@/components/standings/board-strips";
import { DistributionDots, type DistPoint } from "@/components/standings/distribution-dots";
import { scopedTickers } from "@/components/standings/director-card";
import { PayTeaser } from "@/components/pay/pay-teaser";
import { HowItWorks } from "@/components/standings/how-it-works";
import { ManyHats } from "@/components/standings/many-hats";
import { pickPodium, Podium } from "@/components/standings/podium";
import { AsOf, ScopeToggle, SectionHead } from "@/components/standings/primitives";
import { RecordsSection } from "@/components/standings/record-tile";
import { ScoreboardStrip } from "@/components/standings/scoreboard-strip";
import { pickPreview, StandingsPreview } from "@/components/standings/standings-preview";
import { getBoardStrips, getDirectorRankings, getLeaderboardStats, getMultiBoard, getRecords } from "@/lib/queries";
import { barDomain, parseScope, withScope } from "@/lib/standings";

// Reads the scope from searchParams, so it renders per request.
export const metadata: Metadata = { title: { absolute: "Standings: board seats ranked by stock vs the S&P 500 · Boardtape" } };

const LINK = "text-accent-ink hover:underline underline-offset-2";

export default async function Home({ searchParams }: PageProps<"/">) {
  const scope = parseScope(await searchParams);
  const [directors, stats, strips, records, multi] = await Promise.all([
    getDirectorRankings(scope), getLeaderboardStats(scope), getBoardStrips(scope), getRecords(scope), getMultiBoard(scope),
  ]);

  // One symmetric domain for every bar and dot on the page, from the whole scope (§1.3, P0-3).
  const domain = directors.length > 0
    ? barDomain(directors.map((d) => d.score))
    : barDomain(strips.flatMap((r) => r.seats.map((s) => s.annualized_excess)));
  const podium = pickPodium(directors);
  const preview = pickPreview(directors, podium);
  const points: DistPoint[] = directors.map((d) => ({
    slug: d.slug,
    name: d.full_name,
    href: withScope(`/d/${d.slug}`, scope),
    score: d.score,
    rank: d.rank,
    tie: d.tie,
    scored_seats: d.scored_seats,
    scored_years: d.scored_years,
    tickers: scopedTickers(d, 4),
    hollow: d.scored_executive_seat,
  }));
  const ranked = new Map(directors.map((d) => [d.slug, d]));
  const boards = multi.map((m) => m.boards);
  const boardRange = boards.length === 0 ? "" : Math.min(...boards) === Math.max(...boards)
    ? `${Math.min(...boards)}` : `${Math.min(...boards)}–${Math.max(...boards)}`;

  return (
    <div>
      {/* 1. Hero. The scope toggle is a direct child of the page wrapper so it can stay stuck
          under the header on mobile for the whole page, not just the hero. */}
      <section aria-labelledby="standings-title" className="space-y-3 pt-2 md:pt-4">
        <p className="text-[11px] leading-[14px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          Standings{stats.data_through && <> · <AsOf date={stats.data_through} eyebrow /></>}
        </p>
        <h1 id="standings-title" className="text-[26px] leading-8 md:text-[32px] md:leading-[38px] font-bold tracking-[-0.02em] text-ink">
          Who had the best seat in the house?
        </h1>
        <p className="text-[16px] leading-6 text-ink-2 max-w-[62ch]">
          Directors ranked by how their company&rsquo;s stock did against the S&amp;P 500, per year, while they held the seat.
          A stat line about the stock, not a skill rating.
        </p>
      </section>
      <div className="h-5" aria-hidden />
      <ScopeToggle scope={scope} hrefFor={(s) => withScope("/", s)} sticky note />
      <div className="mt-5">
        <ScoreboardStrip stats={stats} />
      </div>

      {/* Sections 2–7 fade in again when the scope changes (§8.4). */}
      <div key={scope} className="anim-fade mt-8 md:mt-12 space-y-8 md:space-y-12">
        {directors.length === 0 ? (
          <section className="rounded-[14px] border border-line bg-surface shadow-card p-4 md:p-5">
            <p className="text-[15px] leading-6 text-ink max-w-[62ch]">
              The standings fill in once directors have 2 scored years. A seat is scored after a year of exact dates.
            </p>
            <p className="mt-3 text-[13px] leading-5"><Link href={withScope("/companies", scope)} className={LINK}>Browse companies →</Link></p>
          </section>
        ) : (
          <>
            {/* 2. Top / Bottom of the table */}
            <Podium {...podium} scope={scope} />

            {/* 3. Where everyone lands */}
            <section aria-labelledby="where-everyone-lands">
              <SectionHead
                id="where-everyone-lands"
                title="Where everyone lands"
                sub="Each dot is one ranked director. Right of the line, the stock beat the S&P 500 per year during their seats."
              />
              <div className="rounded-[14px] border border-line bg-surface shadow-card p-4 md:p-5">
                <DistributionDots
                  points={points}
                  domain={domain}
                  median={stats.median_score}
                  of={directors[0].of}
                  ofLabel="directors"
                  height={220}
                  showHollow={scope === "all"}
                />
              </div>
              <p className="mt-3 text-[13px] leading-5">
                <Link href={withScope("/rankings", scope)} className={LINK}>See it as a table →</Link>
              </p>
            </section>

            {/* 4. The rest of the top 10 / bottom 10 */}
            <StandingsPreview top={preview.top} bottom={preview.bottom} domain={domain} scope={scope} />

            {/* 5. Board by board */}
            <section aria-labelledby="board-by-board">
              <SectionHead
                id="board-by-board"
                title="Board by board"
                sub="Board-mates share one stock, so ranks cluster by company. Each dot is one scored seat; the tick marks the board's median."
              />
              <BoardStrips rows={strips} domain={domain} scope={scope} />
            </section>

            {/* 6. Records */}
            <RecordsSection records={records} scope={scope} />

            {/* 7. Many hats */}
            {multi.length > 0 && (
              <section aria-labelledby="many-hats">
                <SectionHead
                  id="many-hats"
                  title="Many hats"
                  sub={<>{multi.length} people sit on {boardRange} tracked boards. Same person, different boards, very different rides.</>}
                />
                <ManyHats people={multi} ranked={ranked} domain={domain} scope={scope} />
              </section>
            )}
          </>
        )}

        {/* Executive pay, across companies */}
        <PayTeaser />

        {/* 8. How the standings work */}
        <HowItWorks stats={stats} scope={scope} />
      </div>
    </div>
  );
}
