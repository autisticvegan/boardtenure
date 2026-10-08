import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { PayMixBar, PayMixLegend, payMix, perDollar, SignedMoney } from "@/components/pay/pay-primitives";
import { PayScatter, type ScatterDot } from "@/components/pay/pay-scatter";
import { AsOf, SectionHead, Signed } from "@/components/standings/primitives";
import { Card } from "@/components/ui";
import { compactMoney, fmtDate, pct, type Precision } from "@/lib/format";
import { getCompany } from "@/lib/queries";
import {
  getExecPay, getExecPayYears, getPaySpan, getPayVsPerformance, type ExecPay, type ExecPayYear, type PvpYear,
} from "@/lib/queries-pay";
import { median } from "@/lib/track-record";

export const revalidate = 3600;

export async function generateMetadata({ params }: PageProps<"/c/[slug]/pay">): Promise<Metadata> {
  const c = await getCompany((await params).slug);
  return c ? { title: `${c.common_name} executive pay vs the stock · BoardTenure` } : {};
}

const tenureLabel = (e: ExecPay) =>
  `${fmtDate(e.tenure_start, e.tenure_start_precision)} – ${
    e.is_current ? "present" : fmtDate(e.tenure_end, (e.tenure_end_precision ?? "unknown") as Precision)}`;

const fy = (a: number | null, b: number | null) => (a == null ? "—" : a === b ? `FY${a}` : `FY${a}–FY${b}`);

export default async function PayPage({ params }: PageProps<"/c/[slug]/pay">) {
  const { slug } = await params;
  const company = await getCompany(slug);
  if (!company) notFound();
  const [execs, years, pvp, span] = await Promise.all([
    getExecPay(company.id), getExecPayYears(company.id), getPayVsPerformance(company.id), getPaySpan(company.id),
  ]);
  if (execs.length === 0) notFound();

  const sym = company.symbol ?? company.common_name;
  const yearsBy = new Map<number, ExecPayYear[]>();
  for (const y of years) yearsBy.set(y.person_id, [...(yearsBy.get(y.person_id) ?? []), y]);
  const maxYear = Math.max(...years.map((y) => y.total));
  const sources = [...new Map(years.map((y) => [y.source_url, y])).values()]
    .sort((a, b) => b.filed_on.localeCompare(a.filed_on));

  const paid = execs.filter((e) => (e.pay_total ?? 0) > 0);
  const execYears = years.filter((y) => y.in_pay_window);
  const medianPay = median(execYears.map((y) => y.total));
  const spanMcap = span?.start_shares && span.start_close ? span.start_shares * span.start_close : null;
  const spanGap = spanMcap != null && span?.total_return != null && span.bench_total_return != null
    ? spanMcap * (span.total_return - span.bench_total_return) : null;

  const dots: ScatterDot[] = paid
    .filter((e) => e.annualized_excess != null && e.pay_per_year != null)
    .map((e) => ({ key: String(e.person_id), name: e.full_name, payPerYear: e.pay_per_year!, excess: e.annualized_excess! }));
  const unplotted = paid.length - dots.length;

  // Record tiles: the biggest single year, and the widest and best gap per $1 among windows of at
  // least a year (shorter windows swing too far to compare, as with board seats).
  const biggestYear = [...years].sort((a, b) => b.total - a.total)[0];
  const biggestYearExec = execs.find((e) => e.person_id === biggestYear?.person_id);
  const byRatio = paid.filter((e) => e.excess_wealth_per_pay_dollar != null && (e.calendar_days ?? 0) >= 365)
    .sort((a, b) => a.excess_wealth_per_pay_dollar! - b.excess_wealth_per_pay_dollar!);
  const widest = byRatio[0];
  const best = byRatio[byRatio.length - 1];

  return (
    <div className="space-y-8 md:space-y-12">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] leading-4 text-ink-3 mb-2">
            <Link href="/companies" className="inline-flex items-center max-md:min-h-11 hover:text-ink-2">Companies</Link>
            <span aria-hidden>/</span>
            <Link href={`/c/${company.slug}`} className="inline-flex items-center max-md:min-h-11 hover:text-ink-2">{sym}</Link>
            <span aria-hidden>/</span>
            <span aria-current="page">Executive pay</span>
          </nav>
          <h1 className="text-[26px] leading-8 sm:text-[32px] sm:leading-[38px] font-bold tracking-[-0.02em] text-ink">
            {company.common_name} executive pay vs the stock
          </h1>
          {span && (
            <p className="mt-2 text-[15px] leading-6 text-ink-2 max-w-[70ch]">
              From FY{span.first_year} through FY{span.last_year}, {company.common_name} reported{" "}
              <strong className="text-ink">{compactMoney(span.pay_total)}</strong> in pay to its named executive
              officers. Over those years {sym} returned <Signed value={span.total_return} kind="pct" /> against the
              S&amp;P 500&apos;s <Signed value={span.bench_total_return} kind="pct" />.
            </p>
          )}
        </div>
        {company.last_date && <div className="sm:text-right shrink-0"><AsOf date={company.last_date} /></div>}
      </header>

      {span && (
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-px overflow-hidden rounded-[14px] border border-line bg-line shadow-card">
          <Tile label={`reported pay, FY${span.first_year}–FY${span.last_year}`} value={compactMoney(span.pay_total)} />
          <Tile label="median pay per executive-year" value={compactMoney(medianPay)} />
          <Tile label={`${sym} vs S&P 500 since listing, per year`}
                value={<Signed value={annualizedExcess(span)} kind="perYear" />} />
          <Tile label="shareholders vs the same money in the S&P 500"
                value={<SignedMoney value={spanGap} />} />
        </dl>
      )}

      <section aria-labelledby="by-exec">
        <SectionHead
          id="by-exec"
          title="Pay against the stock, executive by executive"
          sub={<>Reported pay for the fiscal years each person was a named executive officer, set against how {sym} did
            over the same window. Highest pay first. Windows under a year are shown but left out of the records below.</>}
        />
        <Card pad={false}>
          <div className="relative overflow-x-auto" role="region" aria-label="Executive pay table" tabIndex={0}>
            <table className="w-full min-w-[880px] text-[13px] leading-5">
              <caption className="sr-only">
                Each executive&apos;s reported pay, the stock against the S&amp;P 500 per year over the same window, and
                shareholders&apos; gain or shortfall against the S&amp;P 500 per dollar of pay.
              </caption>
              <thead className="text-[12px] leading-4 text-ink-3 text-left">
                <tr className="border-b border-line">
                  <th scope="col" className="font-medium px-4 py-3">Executive</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Reported pay</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">{sym} vs S&amp;P / yr</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Shareholders vs S&amp;P</th>
                  <th scope="col" className="font-medium px-4 py-3 text-right">Per $1 of pay</th>
                </tr>
              </thead>
              <tbody>
                {execs.map((e) => (
                  <tr key={e.person_id} className="border-b border-line last:border-0 align-top">
                    <th scope="row" className="font-normal text-left px-4 py-3">
                      {e.has_seat
                        ? <Link href={`/d/${e.person_slug}`} className="font-semibold text-ink hover:text-accent-ink">{e.full_name}</Link>
                        : <span className="font-semibold text-ink">{e.full_name}</span>}
                      <div className="text-ink-3 text-[12px] leading-4 mt-0.5">{e.titles.join(" → ")}</div>
                      <div className="text-ink-3 text-[12px] leading-4">{tenureLabel(e)}</div>
                    </th>
                    <td className="px-3 py-3 text-right">
                      <div className="num text-ink font-semibold">{compactMoney(e.pay_total)}</div>
                      <div className="text-ink-3 text-[12px] leading-4">
                        {fy(e.first_pay_year, e.last_pay_year)}{e.pay_per_year != null && <> · {compactMoney(e.pay_per_year)}/yr</>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {e.annualized_excess != null
                        ? <Signed value={e.annualized_excess} kind="perYear" className="font-semibold" />
                        : e.relative_return_pp != null
                          ? <Signed value={e.relative_return_pp} kind="pp" className="font-semibold" />
                          : <span className="text-ink-3">{e.status === "approximate" ? "range only" : "—"}</span>}
                      <div className="text-ink-3 text-[12px] leading-4">
                        {e.total_return != null
                          ? <>{sym} {pct(e.total_return)} · S&amp;P {pct(e.bench_total_return)}</>
                          : windowNote(e)}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <SignedMoney value={e.excess_wealth} className="font-semibold" />
                      {e.start_market_cap != null && e.start_anchor_date && (
                        <div className="text-ink-3 text-[12px] leading-4">
                          from {compactMoney(e.start_market_cap)} on {fmtDate(e.start_anchor_date)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <SignedMoney value={e.excess_wealth_per_pay_dollar} per className="font-bold text-[15px]" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <p className="mt-3 text-[12px] leading-4 text-ink-3 max-w-[80ch]">
          <strong className="text-ink-2 font-semibold">Per $1 of pay:</strong> what a holder of the whole company at the
          start of the window gained or fell short against the same money in the S&amp;P 500, divided by reported pay.
          {widest?.excess_wealth_per_pay_dollar != null && (
            <> {perDollar(widest.excess_wealth_per_pay_dollar)} means shareholders ended{" "}
              {perDollar(Math.abs(widest.excess_wealth_per_pay_dollar)).slice(1)}{" "}
              {widest.excess_wealth_per_pay_dollar < 0 ? "behind" : "ahead of"} the S&amp;P 500 for every $1 reported.</>
          )}{" "}
          It describes the stock while the person served; it doesn&apos;t measure what they caused.
        </p>
      </section>

      <section aria-labelledby="records" className="grid gap-4 md:grid-cols-3">
        <h2 id="records" className="sr-only">Pay records</h2>
        {biggestYear && biggestYearExec && (
          <Record kicker="Largest single-year package" title={biggestYearExec.full_name}
                  figure={compactMoney(biggestYear.total)}
                  detail={`FY${biggestYear.fiscal_year} · ${pct(share(biggestYear.stock_awards + biggestYear.option_awards, biggestYear.total), 0, false)} in stock and option awards`} />
        )}
        {widest && (
          <Record kicker={widest.excess_wealth_per_pay_dollar! < 0 ? "Widest shortfall per $1 of pay" : "Smallest gain per $1 of pay"}
                  title={widest.full_name}
                  figure={<SignedMoney value={widest.excess_wealth_per_pay_dollar} per />}
                  detail={`${compactMoney(widest.pay_total)} reported · shareholders ${signedWord(widest.excess_wealth)} vs the S&P`} />
        )}
        {best && best !== widest && (
          <Record kicker={best.excess_wealth_per_pay_dollar! >= 0 ? "Biggest gain per $1 of pay" : "Narrowest shortfall per $1 of pay"}
                  title={best.full_name}
                  figure={<SignedMoney value={best.excess_wealth_per_pay_dollar} per />}
                  detail={`${compactMoney(best.pay_total)} reported · shareholders ${signedWord(best.excess_wealth)} vs the S&P`} />
        )}
      </section>

      {dots.length > 1 && (
        <section aria-labelledby="scatter">
          <SectionHead
            id="scatter"
            title="Pay per year vs the stock per year"
            sub={<>Right is more pay; up is a stock that beat the S&amp;P 500 over the same window.
              {unplotted > 0 && <> Windows under a year aren&apos;t plotted.</>}</>}
          />
          <Card><PayScatter dots={dots} medianPay={median(dots.map((d) => d.payPerYear))} /></Card>
        </section>
      )}

      <section aria-labelledby="by-year">
        <SectionHead
          id="by-year"
          title="Year by year"
          sub={<>Each fiscal year&apos;s reported pay beside how {sym} did against the S&amp;P 500 in the part of that year
            the person served. Stock and option awards are valued at grant, not at what they later became worth.</>}
          action={<PayMixLegend />}
        />
        <Card pad={false}>
          <div className="relative overflow-x-auto" role="region" aria-label="Pay by fiscal year" tabIndex={0}>
            <table className="w-full min-w-[820px] text-[13px] leading-5">
              <caption className="sr-only">Reported pay by fiscal year and the stock against the S&amp;P 500 in that year.</caption>
              <thead className="text-[12px] leading-4 text-ink-3 text-left">
                <tr className="border-b border-line">
                  <th scope="col" className="font-medium px-4 py-3">Year</th>
                  <th scope="col" className="font-medium px-3 py-3">Pay mix</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Reported pay</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">{sym}</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">S&amp;P 500</th>
                  <th scope="col" className="font-medium px-4 py-3 text-right">{sym} vs S&amp;P</th>
                </tr>
              </thead>
              <tbody>
                {execs.map((e) => (
                  <Fragment key={e.person_id}>
                    <tr className="bg-surface-2 border-b border-line">
                      <th scope="colgroup" colSpan={6} className="text-left px-4 py-2 text-[13px] font-semibold text-ink">
                        {e.full_name} <span className="font-normal text-ink-3">· {e.titles.join(" → ")}</span>
                      </th>
                    </tr>
                    {(yearsBy.get(e.person_id) ?? []).map((y) => {
                      const mix = payMix(y);
                      return (
                        <tr key={y.fiscal_year} className={`border-b border-line last:border-0 ${y.in_pay_window ? "" : "text-ink-3"}`}>
                          <th scope="row" className="font-normal text-left px-4 py-2.5 whitespace-nowrap">
                            FY{y.fiscal_year}
                            {y.listed_title && <div className="text-[12px] leading-4 text-ink-3 max-w-[220px] truncate" title={y.listed_title}>{y.listed_title}</div>}
                          </th>
                          <td className="px-3 py-2.5">
                            <PayMixBar mix={mix} max={maxYear} />
                            <span className="sr-only">
                              Cash {compactMoney(mix.cash)}, stock and option awards {compactMoney(mix.equity)}, other {compactMoney(mix.other)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right num text-ink">
                            <a href={y.source_url} target="_blank" rel="noreferrer"
                               className="hover:text-accent-ink underline decoration-line-strong underline-offset-2"
                               title={`${y.source_form} filed ${fmtDate(y.filed_on)}`}>
                              {compactMoney(y.total)}
                            </a>
                          </td>
                          {y.year_total_return != null ? (
                            <>
                              <td className="px-3 py-2.5 text-right"><Signed value={y.year_total_return} kind="pct" /></td>
                              <td className="px-3 py-2.5 text-right"><Signed value={y.year_bench_total_return} kind="pct" /></td>
                              <td className="px-4 py-2.5 text-right"><Signed value={y.year_relative_pp} kind="pp" className="font-semibold" /></td>
                            </>
                          ) : (
                            <td colSpan={3} className="px-4 py-2.5 text-right text-ink-3">
                              {y.year_status === "no_price_history" ? "Before listing" : "Not measured"}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {pvp.length > 0 && <PvpSection rows={pvp} sym={sym} />}

      <section aria-labelledby="how" className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start">
        <Card title={<span id="how">How this is measured</span>}>
          <ul className="space-y-2 text-[13px] leading-5 text-ink-2 list-disc pl-5">
            <li><strong className="text-ink font-semibold">Reported pay</strong> is the Summary Compensation Table total
              from the proxy statement: salary, bonus, the grant-date value of stock and option awards, incentive pay,
              and other compensation. It is what the board awarded, not what the awards were later worth.</li>
            <li><strong className="text-ink font-semibold">Named executive officers only.</strong> Proxies disclose pay for
              the CEO, CFO and the next most highly paid officers each year; other officers&apos; pay isn&apos;t public.</li>
            <li><strong className="text-ink font-semibold">Same window for pay and stock.</strong> The stock is measured
              from the start of the person&apos;s officer tenure (or the first trading day, if earlier) to the end of the
              tenure or of the last fiscal year with reported pay, whichever comes first. Pay counts the fiscal years in
              that window; years before listing are shown but not counted.</li>
            <li><strong className="text-ink font-semibold">Shareholders vs S&amp;P</strong> is the company&apos;s market
              value at the start of the window times the stock&apos;s return minus the S&amp;P 500&apos;s (SPY total
              return). Market value uses the 10-K/10-Q cover share count nearest the start, all classes at the listed
              price.</li>
            <li>Executives serve with a board, other executives and a market. These numbers describe the stock while a
              person served; they don&apos;t show what any one person caused.</li>
          </ul>
          <p className="mt-3 text-[12px] leading-4 text-ink-3">
            <Link href="/methodology#executive-pay" className="hover:text-ink-2 underline underline-offset-2">Full methodology</Link>
          </p>
        </Card>
        <Card title="Sources">
          <ul className="space-y-1.5 text-[13px] leading-5">
            {sources.map((s) => (
              <li key={s.source_url}>
                <a href={s.source_url} target="_blank" rel="noreferrer" className="text-ink-2 hover:text-ink underline decoration-line-strong underline-offset-2">
                  {s.source_form} filed {fmtDate(s.filed_on)}
                </a>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}

function PvpSection({ rows, sym }: { rows: PvpYear[]; sym: string }) {
  return (
    <section aria-labelledby="pvp">
      <SectionHead
        id="pvp"
        title="CEO pay: reported vs actually paid"
        sub={<>From the proxy&apos;s pay-versus-performance table. &ldquo;Compensation actually paid&rdquo; is the SEC&apos;s
          measure that marks equity awards to their year-end value, so it rises and falls with {sym}.</>}
      />
      <Card pad={false}>
        <div className="relative overflow-x-auto" role="region" aria-label="Pay versus performance table" tabIndex={0}>
          <table className="w-full min-w-[760px] text-[13px] leading-5">
            <caption className="sr-only">CEO reported pay, compensation actually paid, and cumulative shareholder return by year.</caption>
            <thead className="text-[12px] leading-4 text-ink-3 text-left">
              <tr className="border-b border-line">
                <th scope="col" className="font-medium px-4 py-3">Year</th>
                <th scope="col" className="font-medium px-3 py-3">CEO</th>
                <th scope="col" className="font-medium px-3 py-3 text-right">Reported</th>
                <th scope="col" className="font-medium px-3 py-3 text-right">Actually paid</th>
                <th scope="col" className="font-medium px-3 py-3 text-right">Other executives (avg)</th>
                <th scope="col" className="font-medium px-4 py-3 text-right">$100 in {sym} became</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => r.peos.map((p, i) => (
                <tr key={`${r.fiscal_year}-${p.person_id}`} className="border-b border-line last:border-0">
                  {i === 0 && <th scope="row" rowSpan={r.peos.length} className="font-normal text-left px-4 py-2.5 align-top">FY{r.fiscal_year}</th>}
                  <td className="px-3 py-2.5 text-ink">{p.full_name}</td>
                  <td className="px-3 py-2.5 text-right num">{compactMoney(p.sct_total)}</td>
                  <td className="px-3 py-2.5 text-right num">
                    <span className={p.cap != null && p.cap < 0 ? "text-loss-ink" : "text-ink"}>
                      {p.cap != null && p.cap < 0 ? `−${compactMoney(-p.cap)}` : compactMoney(p.cap)}
                    </span>
                  </td>
                  {i === 0 && (
                    <>
                      <td rowSpan={r.peos.length} className="px-3 py-2.5 text-right num align-top text-ink-2">
                        {compactMoney(r.non_peo_avg_sct_total)} <span className="text-ink-3">→</span>{" "}
                        {r.non_peo_avg_cap != null && r.non_peo_avg_cap < 0 ? `−${compactMoney(-r.non_peo_avg_cap)}` : compactMoney(r.non_peo_avg_cap)}
                      </td>
                      <td rowSpan={r.peos.length} className="px-4 py-2.5 text-right align-top">
                        <span className="num text-ink">${r.tsr_value_of_100?.toFixed(2) ?? "—"}</span>
                        {r.tsr_base_date && <div className="text-[12px] leading-4 text-ink-3">from {fmtDate(r.tsr_base_date)}</div>}
                      </td>
                    </>
                  )}
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
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

function Record({ kicker, title, figure, detail }: { kicker: string; title: string; figure: ReactNode; detail: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface px-5 py-4 shadow-card">
      <div className="text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">{kicker}</div>
      <div className="mt-1 text-[15px] leading-5 font-semibold text-ink">{title}</div>
      <div className="mt-2 text-[32px] leading-[36px] font-extrabold tracking-[-0.02em] text-ink">{figure}</div>
      <div className="mt-1 text-[12px] leading-4 text-ink-3">{detail}</div>
    </div>
  );
}

function annualizedExcess(s: { total_return: number | null; bench_total_return: number | null; start_anchor: string | null; end_anchor: string | null }) {
  if (s.total_return == null || s.bench_total_return == null || !s.start_anchor || !s.end_anchor) return null;
  const days = (Date.parse(s.end_anchor) - Date.parse(s.start_anchor)) / 86_400_000;
  if (days < 365) return null;
  return ((1 + s.total_return) / (1 + s.bench_total_return)) ** (365.25 / days) - 1;
}

const share = (part: number, total: number) => (total > 0 ? part / total : 0);
const signedWord = (x: number | null) => (x == null ? "—" : `${x < 0 ? "−" : "+"}${compactMoney(Math.abs(x))}`);

function windowNote(e: ExecPay): string {
  if (e.status === "no_price_history") return "Left before listing";
  if (e.status === "too_short") return "Under one trading day";
  if (e.status === "approximate" && e.return_low != null)
    return `${pct(e.return_low)} to ${pct(e.return_high)} (dates known to the month)`;
  return "Not measured";
}

