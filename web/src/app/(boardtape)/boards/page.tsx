import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SectionHead, Signed } from "@/components/standings/primitives";
import { Card } from "@/components/ui";
import { compactMoney } from "@/lib/format";
import {
  getBiggestReactions, getBoardYears, getDetectability, getReactionStats, type BigReaction, type BoardYear, type ReactionStat,
} from "@/lib/queries-boards";
import { median } from "@/lib/track-record";

export const metadata: Metadata = { title: "What boards cost" };
export const revalidate = 3600;

// A seat's record distinguishes an effect from chance at about two standard errors.
const Z = 2;

/** Share of market value as a readable percent with enough decimals to show it. */
function tinyPct(x: number | null | undefined): string {
  if (x == null) return "—";
  const v = x * 100;
  const digits = Math.max(2, Math.min(6, Math.ceil(-Math.log10(v)) + 1));
  return `${v.toFixed(digits)}%`;
}

export default async function BoardsPage() {
  const [years, detect, reactions, biggest] = await Promise.all([
    getBoardYears(), getDetectability(), getReactionStats(), getBiggestReactions(),
  ]);
  // Tesla's board took no pay from 2021 under a court settlement over its earlier awards, so its
  // years say nothing about how pay responds to results; they stay in the tables, not the test.
  const tested = years.filter((y) => y.slug !== "tsla" && y.prev_median_paid && y.median_paid && y.prior_relative_pp != null);
  const change = (y: BoardYear) => y.median_paid! / y.prev_median_paid! - 1;
  const afterTrail = tested.filter((y) => y.prior_relative_pp! < 0);
  const afterBeat = tested.filter((y) => y.prior_relative_pp! >= 0);
  const roseOrHeld = (ys: BoardYear[]) => ys.filter((y) => change(y) >= 0).length;

  const companies = [...new Map(years.map((y) => [y.company_id, y])).values()].sort((a, b) => a.common_name.localeCompare(b.common_name));
  const latest = (id: number) => [...years].reverse().find((y) => y.company_id === id && y.board_total > 0);
  const detectBy = new Map(detect.map((d) => [d.company_id, d]));
  const shares = years.filter((y) => y.pay_share_of_mcap != null && y.board_total > 0).map((y) => y.pay_share_of_mcap!);
  const medianDirector = median(years.filter((y) => y.median_paid).map((y) => y.median_paid!));
  const seatYears = median(detect.map((d) => d.median_seat_years ?? 0).filter(Boolean));
  const te = median(detect.map((d) => d.tracking_error));
  const mde = te != null && seatYears ? (Z * te) / Math.sqrt(seatYears) : null;
  const medShare = median(shares);
  // Break-even for one director: their pay as a share of the company's value.
  const directorShare = median(years.filter((y) => y.median_paid && y.start_market_cap)
    .map((y) => y.median_paid! / y.start_market_cap!));

  return (
    <div className="space-y-10 md:space-y-14">
      <header className="max-w-[860px]">
        <div className="text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">Board pay</div>
        <h1 className="mt-1 text-[26px] leading-8 sm:text-[32px] sm:leading-[38px] font-bold tracking-[-0.02em] text-ink">What boards cost, and what anyone can tell about it</h1>
        <p className="mt-2 text-[15px] leading-6 text-ink-2">
          What non-employee directors were paid, from each proxy&apos;s Director Compensation table, set against the stock.
          Two questions: does director pay respond to how the stock did, and could stock data ever show whether
          directors earn it?
        </p>
      </header>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-px overflow-hidden rounded-[14px] border border-line bg-line shadow-card">
        <Tile value={compactMoney(medianDirector)} label="median director pay per year" />
        <Tile value={tinyPct(medShare)} label="median board cost per year, as a share of market value" />
        <Tile value={mde != null ? `±${Math.round(mde * 100)}%/yr` : "—"}
              label={`smallest per-year effect one ${seatYears?.toFixed(1)}-year seat could tell from chance`} />
        <Tile value={mde != null && directorShare ? `${Math.round(mde / directorShare).toLocaleString("en-US")}×` : "—"}
              label={`larger than a director's break-even: pay of ${tinyPct(directorShare)} of market value a year`} />
      </dl>

      <section aria-labelledby="sensitivity">
        <SectionHead id="sensitivity" title="Does director pay follow the stock?"
                     sub="Each board-year's median director pay against the year before, split by how the stock did against the S&P 500 in that prior year, when the pay was set." />
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <div className="text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">After the stock trailed the S&amp;P 500</div>
            <div className="mt-2 text-[32px] leading-[36px] font-extrabold text-ink">{roseOrHeld(afterTrail)} <span className="text-[18px] text-ink-3">of</span> {afterTrail.length}</div>
            <div className="text-[13px] text-ink-2">boards kept or raised median director pay · median change <Signed value={median(afterTrail.map(change))} kind="pct" /></div>
          </Card>
          <Card>
            <div className="text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">After the stock beat the S&amp;P 500</div>
            <div className="mt-2 text-[32px] leading-[36px] font-extrabold text-ink">{roseOrHeld(afterBeat)} <span className="text-[18px] text-ink-3">of</span> {afterBeat.length}</div>
            <div className="text-[13px] text-ink-2">boards kept or raised median director pay · median change <Signed value={median(afterBeat.map(change))} kind="pct" /></div>
          </Card>
        </div>
        <p className="mt-3 text-[12px] leading-4 text-ink-3 max-w-[80ch]">
          {tested.length} board-years at {new Set(tested.map((y) => y.slug)).size} companies; Tesla is left out because a court
          settlement over earlier director awards stopped its board&apos;s pay from 2021. Director stock grants are usually a
          fixed dollar target set by policy, so year-to-year moves mostly reflect policy changes, first-year grants and
          grant-date prices. A small sample: read it as &ldquo;no sign pay falls after bad years&rdquo;, not a measured effect.
        </p>
      </section>

      <Reactions stats={reactions} biggest={biggest} directorPay={medianDirector} />

      <section aria-labelledby="too-small">
        <SectionHead id="too-small" title="Too small to measure"
                     sub="Board cost per year against the smallest effect a director's seat record could reveal. When a director's pay is a sliver of what stock data can detect, no stock study can show they're overpaid, or worth it." />
        <Card pad={false}>
          <div className="relative overflow-x-auto" role="region" aria-label="Board cost and detectability" tabIndex={0}>
            <table className="w-full min-w-[760px] text-[13px] leading-5">
              <thead className="text-[12px] leading-4 text-ink-3 text-left">
                <tr className="border-b border-line">
                  <th scope="col" className="font-medium px-4 py-3">Company</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Board cost, latest year</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Share of market value</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Stock vs S&amp;P noise</th>
                  <th scope="col" className="font-medium px-4 py-3 text-right">Detectable per seat</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => {
                  const l = latest(c.company_id);
                  const d = detectBy.get(c.company_id);
                  const seatMde = d?.median_seat_years ? (Z * d.tracking_error) / Math.sqrt(d.median_seat_years) : null;
                  return (
                    <tr key={c.slug} className="border-b border-line last:border-0">
                      <th scope="row" className="font-normal text-left px-4 py-2.5">
                        <Link href={`/c/${c.slug}`} className="font-semibold text-ink hover:text-accent-ink">{c.common_name}</Link>
                        {l && <span className="text-ink-3"> · FY{l.fiscal_year}</span>}
                      </th>
                      <td className="px-3 py-2.5 text-right num text-ink">{l ? compactMoney(l.board_total) : "—"}</td>
                      <td className="px-3 py-2.5 text-right num text-ink-2">{tinyPct(l?.pay_share_of_mcap)}</td>
                      <td className="px-3 py-2.5 text-right num text-ink-2">{d ? `${Math.round(d.tracking_error * 100)}%/yr` : "—"}</td>
                      <td className="px-4 py-2.5 text-right num font-semibold text-ink">{seatMde != null ? `±${Math.round(seatMde * 100)}%/yr` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <p className="mt-3 text-[12px] leading-4 text-ink-3 max-w-[80ch]">
          Noise is the annualized standard deviation of the stock&apos;s daily return minus SPY&apos;s since 2016. A seat&apos;s
          per-year result has a standard error of about noise ÷ √years; the detectable effect is twice that, for the
          company&apos;s median scored seat length. Every director on a board shares one stock, so the record can&apos;t split
          a result between them at all.
        </p>
      </section>

      <section aria-labelledby="by-year">
        <SectionHead id="by-year" title="Board cost, year by year"
                     sub="Total non-employee director pay as reported, and the stock against the S&P 500 in that fiscal year." />
        <Card pad={false}>
          <div className="relative overflow-x-auto" role="region" aria-label="Board cost by year" tabIndex={0}>
            <table className="w-full min-w-[720px] text-[13px] leading-5">
              <thead className="text-[12px] leading-4 text-ink-3 text-left">
                <tr className="border-b border-line">
                  <th scope="col" className="font-medium px-4 py-3">Company</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">FY</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Directors paid</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Board total</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Median director</th>
                  <th scope="col" className="font-medium px-4 py-3 text-right">Stock vs S&amp;P that year</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={`${y.slug}-${y.fiscal_year}`} className="border-b border-line last:border-0">
                    <th scope="row" className="font-normal text-left px-4 py-2 text-ink">{y.common_name}</th>
                    <td className="px-3 py-2 text-right text-ink-2">{y.fiscal_year}</td>
                    <td className="px-3 py-2 text-right text-ink-2">{y.directors_paid}</td>
                    <td className="px-3 py-2 text-right num text-ink">{compactMoney(y.board_total)}</td>
                    <td className="px-3 py-2 text-right num text-ink-2">{compactMoney(y.median_paid)}</td>
                    <td className="px-4 py-2 text-right"><Signed value={y.relative_return_pp} kind="pp" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <p className="mt-3 text-[12px] leading-4 text-ink-3">
          Shares of market value use the 10-K/10-Q cover share count at the fiscal year&apos;s start and that day&apos;s close
          (split-adjusted). Tesla&apos;s FY2018 total is its directors&apos; option grants as reported, later partly
          returned under the settlement.
        </p>
      </section>
    </div>
  );
}

function Tile({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex flex-col-reverse justify-end min-w-0 bg-surface px-4 py-3 md:px-5 md:py-4">
      <dt className="mt-0.5 text-[12px] leading-4 text-ink-3">{label}</dt>
      <dd className="text-[24px] leading-[30px] font-bold tracking-[-0.01em] text-ink whitespace-nowrap">{value}</dd>
    </div>
  );
}

const REACTION_LABEL: Record<ReactionStat["category"], string> = {
  appointed: "Director appointed mid-year",
  elected: "Director elected at the annual meeting",
  resigned: "Director resigned",
  not_standing: "Director won't stand again",
  exec_change: "CEO or executive joins or leaves the board",
};

/** Mean three-day abnormal return per kind of board change, with a 95% interval, on one scale. */
function Reactions({ stats, biggest, directorPay }: { stats: ReactionStat[]; biggest: BigReaction[]; directorPay: number | null }) {
  if (stats.length === 0) return null;
  const ci = (s: ReactionStat) => 1.96 * s.sd_car / Math.sqrt(s.n);
  const dom = Math.max(0.02, ...stats.map((s) => Math.abs(s.mean_car) + ci(s)));
  const x = (v: number) => `${50 + (v / dom) * 50}%`;
  const appointed = stats.find((s) => s.category === "appointed");
  const bound = appointed ? ci(appointed) : null;
  const excluded = stats.filter((s) => Math.abs(s.mean_car) > ci(s));
  return (
    <section aria-labelledby="reactions">
      <SectionHead id="reactions" title="How the market reacted"
                   sub="When a board change was announced, how the stock moved over three trading days compared with what its usual relationship to the S&P 500 predicted. Announcements that landed with earnings, another material filing or other board changes are set aside, so the move is the board change's alone." />
      <Card>
        <ul className="space-y-4">
          {stats.map((s) => {
            const half = ci(s);
            return (
              <li key={s.category} className="grid gap-x-6 gap-y-1 md:grid-cols-[260px_1fr_150px] items-center">
                <div className="text-[13px] leading-5 text-ink">{REACTION_LABEL[s.category]} <span className="text-ink-3">· {s.n}</span>
                  {s.set_aside > 0 && <span className="block text-[11px] leading-4 text-ink-3">{s.set_aside} set aside for other news</span>}
                </div>
                <div aria-hidden className="relative h-6">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-zero" />
                  <span className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-ink-3" style={{ left: x(s.mean_car - half), right: `calc(100% - ${x(s.mean_car + half)})` }} />
                  <span className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ${s.mean_car >= 0 ? "bg-gain" : "bg-loss"}`} style={{ left: x(s.mean_car) }} />
                </div>
                <div className="text-[13px] leading-5 text-right">
                  <Signed value={s.mean_car} kind="pct" digits={2} /> <span className="text-ink-3">± {(half * 100).toFixed(2)}</span>
                  <div className="text-[11px] leading-4 text-ink-3">median <Signed value={s.median_car} kind="pct" digits={2} /> · {Math.round(s.pct_positive * 100)}% rose</div>
                </div>
                <span className="sr-only">Mean {(s.mean_car * 100).toFixed(2)}%, 95% interval {((s.mean_car - half) * 100).toFixed(2)}% to {((s.mean_car + half) * 100).toFixed(2)}%.</span>
              </li>
            );
          })}
        </ul>
        <div aria-hidden className="mt-2 md:ml-[284px] md:mr-[174px] flex justify-between text-[11px] text-ink-3">
          <span>−{(dom * 100).toFixed(1)}%</span><span>0</span><span>+{(dom * 100).toFixed(1)}%</span>
        </div>
      </Card>
      <div className="mt-3 space-y-2 text-[12px] leading-4 text-ink-3 max-w-[80ch]">
        <p>
          Dot: mean abnormal return over days −1 to +1 around the announcement; line: 95% interval. An interval that
          crosses zero means no reaction distinguishable from chance.
          {excluded.map((s) => (
            <span key={s.category}>
              {" "}{REACTION_LABEL[s.category]}: the interval excludes zero, but weighting each event by its own stock&apos;s
              usual noise (z = {s.z.toFixed(1)}) {Math.abs(s.z) >= 1.96 ? "confirms it" : "doesn't confirm it"}, and the
              median is <Signed value={s.median_car} kind="pct" digits={2} />.
            </span>
          ))}
          {" "}With {stats.length} kinds tested, one landing near the edge by chance is expected, and a three-day window
          can&apos;t separate a board change from other news the same days.
        </p>
        {bound != null && appointed?.median_market_cap != null && (
          <p>
            The bound is the informative part: the average reaction to a new director is within about
            ±{(bound * 100).toFixed(1)}% of zero, which at a typical company here is up to{" "}
            {compactMoney(bound * appointed.median_market_cap)} of market value either way, against board seats paid
            about {compactMoney(directorPay)} a year. This data can&apos;t rule out directors being worth far more, or far
            less, than they&apos;re paid.
          </p>
        )}
      </div>
      {biggest.length > 0 && (
        <details className="mt-3 rounded-[14px] border border-line bg-surface px-5 py-3 text-[13px] leading-5">
          <summary className="cursor-pointer text-ink-2 font-semibold">The largest moves</summary>
          <ul className="mt-2 space-y-1">
            {biggest.map((b) => (
              <li key={`${b.slug}-${b.day0}`} className="flex flex-wrap gap-x-3">
                <Signed value={b.car} kind="pct" digits={1} className="w-16" />
                <span className="text-ink">{b.common_name}</span>
                <span className="text-ink-3">{b.day0}</span>
                <span className="text-ink-2">{b.summary}</span>
                {(b.near_earnings || b.other_news) && (
                  <span className="text-[11px] leading-4 rounded-full border border-line-strong px-2 text-ink-3">
                    {b.near_earnings ? "earnings that day" : "other filing that day"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
