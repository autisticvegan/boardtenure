import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SignedMoney } from "@/components/pay/pay-primitives";
import { PayScatter, type ScatterDot } from "@/components/pay/pay-scatter";
import { SectionHead, Signed } from "@/components/standings/primitives";
import { Card } from "@/components/ui";
import { compactMoney } from "@/lib/format";
import { getAllExecPay, getBiggestExecYear, getPayCompaniesOverview, type ExecPayAcross } from "@/lib/queries-pay";
import { perYear } from "@/lib/standings";
import { median } from "@/lib/track-record";

export const metadata: Metadata = { title: "Executive pay vs the stock" };
export const revalidate = 3600;

const MIN_DAYS = 365;
const LIST_LEN = 8;
const LEVEL = 0.0005; // |x| under 0.05%/yr reads as level, so it sits in neither list

/** Spearman rank correlation (average ranks for ties). */
function spearman(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 5) return null;
  const rank = (v: number[]) => {
    const order = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(n);
    for (let i = 0; i < n; ) {
      let j = i;
      while (j + 1 < n && order[j + 1][0] === order[i][0]) j++;
      for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

function correlationWords(rho: number): string {
  const a = Math.abs(rho);
  if (a < 0.1) return "no relationship by rank";
  const strength = a < 0.3 ? "weak" : a < 0.5 ? "moderate" : "strong";
  return `a ${strength} ${rho > 0 ? "positive" : "negative"} relationship by rank`;
}

export default async function PayOverviewPage() {
  const [companies, execs, biggest] = await Promise.all([getPayCompaniesOverview(), getAllExecPay(), getBiggestExecYear()]);
  if (companies.length === 0) {
    return <p className="text-ink-2">No executive pay is on file yet.</p>;
  }
  const scored = execs.filter((e) => (e.calendar_days ?? 0) >= MIN_DAYS && e.annualized_excess != null && e.pay_per_year != null);
  const ceos = execs.filter((e) => e.is_ceo);
  const others = execs.filter((e) => !e.is_ceo);
  const beat = scored.filter((e) => e.annualized_excess! > 0).length;
  const rho = spearman(scored.map((e) => e.pay_per_year!), scored.map((e) => e.annualized_excess!));
  const firstYear = Math.min(...companies.map((c) => c.first_year));
  const lastYear = Math.max(...companies.map((c) => c.last_year));
  const payTotal = companies.reduce((a, c) => a + c.pay_total, 0);

  const trailed = scored.filter((e) => e.annualized_excess! <= -LEVEL).slice(0, LIST_LEN); // already by pay/yr desc
  const beatList = scored.filter((e) => e.annualized_excess! >= LEVEL).slice(0, LIST_LEN);
  const dots: ScatterDot[] = scored.map((e) => ({
    key: `${e.company_slug}-${e.person_id}`,
    name: `${lastName(e.full_name)} (${e.symbol ?? e.company_name})`,
    payPerYear: e.pay_per_year!,
    excess: e.annualized_excess!,
    label: e.is_ceo,
    title: `${e.full_name}, ${e.company_name}: ${compactMoney(e.pay_per_year)} a year; stock ${perYear(e.annualized_excess)} vs the S&P 500`,
  }));

  return (
    <div className="space-y-8 md:space-y-12">
      <header>
        <div className="text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">Executive pay</div>
        <h1 className="mt-1 text-[26px] leading-8 sm:text-[32px] sm:leading-[38px] font-bold tracking-[-0.02em] text-ink">
          Executive pay vs the stock
        </h1>
        <p className="mt-2 text-[15px] leading-6 text-ink-2 max-w-[72ch]">
          What companies reported paying their named executive officers, FY{firstYear} to FY{lastYear}, set against how
          each stock did against the S&amp;P 500 over the same years:{" "}
          <strong className="text-ink">{compactMoney(payTotal)}</strong> across {execs.length} executives
          at {companies.length} companies.
          {biggest && biggest.total > payTotal / 2 && (
            <> {compactMoney(biggest.total)} of that is a single executive-year: {biggest.full_name}&apos;s
              FY{biggest.fiscal_year} package at {biggest.company_name}, as reported.</>
          )}
        </p>
      </header>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-px overflow-hidden rounded-[14px] border border-line bg-line shadow-card">
        <Tile label="median CEO pay per year" value={compactMoney(median(ceos.map((e) => e.pay_per_year ?? 0)))} />
        <Tile label="median pay per year, other named executives" value={compactMoney(median(others.map((e) => e.pay_per_year ?? 0)))} />
        <Tile label="windows where the stock beat the S&P 500"
              value={<>{beat} <span className="text-[16px] font-semibold text-ink-3">of</span> {scored.length}</>} />
        <Tile label="rank correlation: pay per year vs stock vs S&P"
              value={rho == null ? "—" : `${rho < 0 ? "−" : "+"}${Math.abs(rho).toFixed(2)}`} />
      </dl>
      {rho != null && (
        <p className="-mt-6 md:-mt-9 text-[12px] leading-4 text-ink-3 max-w-[80ch]">
          Across executives with a pay window of at least a year, pay per year and the stock against the S&amp;P 500 per
          year show {correlationWords(rho)} (Spearman). Executives at the same company share one stock, so these aren&apos;t
          independent observations, and a correlation says nothing about cause in either direction.
        </p>
      )}

      <section aria-labelledby="scatter">
        <SectionHead id="scatter" title="Every executive, pay per year vs the stock per year"
                     sub="Right is more pay; up is a stock that beat the S&P 500 over the same window. CEOs are labelled; hover any dot for its details. Windows under a year aren't plotted." />
        <Card><PayScatter dots={dots} medianPay={median(dots.map((d) => d.payPerYear))} /></Card>
      </section>

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <ExecList id="most-trailed" title="Most pay while the stock trailed the S&P 500"
                  sub="Highest reported pay per year where the stock trailed the S&P 500 per year over the same window." rows={trailed} />
        <ExecList id="most-beat" title="Most pay while the stock beat the S&P 500"
                  sub="Highest reported pay per year where the stock beat the S&P 500 per year over the same window." rows={beatList} />
      </div>

      <section aria-labelledby="ceos">
        <SectionHead id="ceos" title="CEOs side by side"
                     sub="Each CEO's reported pay over the fiscal years they were a named executive, against the stock over those years. Highest pay per year first." />
        <Card pad={false}>
          <div className="relative overflow-x-auto" role="region" aria-label="CEO pay table" tabIndex={0}>
            <table className="w-full min-w-[760px] text-[13px] leading-5">
              <caption className="sr-only">CEO pay per year and the stock against the S&amp;P 500 per year.</caption>
              <thead className="text-[12px] leading-4 text-ink-3 text-left">
                <tr className="border-b border-line">
                  <th scope="col" className="font-medium px-4 py-3">CEO</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Years</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Pay per year</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Stock vs S&amp;P / yr</th>
                  <th scope="col" className="font-medium px-4 py-3 text-right">Shareholders vs S&amp;P</th>
                </tr>
              </thead>
              <tbody>
                {ceos.map((e) => (
                  <tr key={`${e.company_slug}-${e.person_id}`} className="border-b border-line last:border-0">
                    <th scope="row" className="font-normal text-left px-4 py-2.5">
                      <Link href={`/c/${e.company_slug}/pay`} className="font-semibold text-ink hover:text-accent-ink">{e.full_name}</Link>
                      <span className="text-ink-3"> · {e.company_name}</span>
                    </th>
                    <td className="px-3 py-2.5 text-right text-ink-2 whitespace-nowrap">FY{e.first_pay_year}{e.last_pay_year !== e.first_pay_year && <>–FY{e.last_pay_year}</>}</td>
                    <td className="px-3 py-2.5 text-right num text-ink font-semibold">{compactMoney(e.pay_per_year)}</td>
                    <td className="px-3 py-2.5 text-right">{excessCell(e)}</td>
                    <td className="px-4 py-2.5 text-right"><SignedMoney value={e.excess_wealth} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <section aria-labelledby="companies">
        <SectionHead id="companies" title="By company"
                     sub="Every fiscal year with reported executive pay, and the stock over those same years." />
        <Card pad={false}>
          <div className="relative overflow-x-auto" role="region" aria-label="Pay by company" tabIndex={0}>
            <table className="w-full min-w-[760px] text-[13px] leading-5">
              <caption className="sr-only">Reported executive pay by company and the stock against the S&amp;P 500.</caption>
              <thead className="text-[12px] leading-4 text-ink-3 text-left">
                <tr className="border-b border-line">
                  <th scope="col" className="font-medium px-4 py-3">Company</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Years</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Reported pay</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Median executive-year</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Stock</th>
                  <th scope="col" className="font-medium px-4 py-3 text-right">vs S&amp;P / yr</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.slug} className="border-b border-line last:border-0">
                    <th scope="row" className="font-normal text-left px-4 py-2.5">
                      <Link href={`/c/${c.slug}/pay`} className="font-semibold text-ink hover:text-accent-ink">{c.common_name}</Link>
                      <div className="text-[12px] leading-4 text-ink-3">{c.people} executives · {c.ceos.join(", ")}</div>
                    </th>
                    <td className="px-3 py-2.5 text-right text-ink-2 whitespace-nowrap">FY{c.first_year}–FY{c.last_year}</td>
                    <td className="px-3 py-2.5 text-right num text-ink font-semibold">{compactMoney(c.pay_total)}</td>
                    <td className="px-3 py-2.5 text-right num text-ink-2">{compactMoney(c.median_pay_per_year)}</td>
                    <td className="px-3 py-2.5 text-right"><Signed value={c.total_return} kind="pct" /></td>
                    <td className="px-4 py-2.5 text-right"><Signed value={c.annualized_excess} kind="perYear" className="font-semibold" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <Card title="Reading these numbers">
        <ul className="space-y-2 text-[13px] leading-5 text-ink-2 list-disc pl-5">
          <li><strong className="text-ink font-semibold">Reported pay</strong> is the proxy&apos;s Summary Compensation Table
            total, with stock and option awards at their value when granted. A single award can dominate: a CEO
            performance grant reported in one year is counted in full in that year.</li>
          <li><strong className="text-ink font-semibold">Medians lead</strong> because a few awards are orders of magnitude
            larger than the rest.</li>
          <li><strong className="text-ink font-semibold">&ldquo;Per $1 of pay&rdquo; stays on company pages.</strong> It
            scales with company size, so it compares executives within a company, not across them.</li>
          <li>Executives work with a board, other executives and a market; these figures describe the stock while a person
            served, not what they caused.{" "}
            <Link href="/methodology#executive-pay" className="underline underline-offset-2 hover:text-ink">Methodology</Link></li>
        </ul>
      </Card>
    </div>
  );
}

function ExecList({ id, title, sub, rows }: { id: string; title: string; sub: string; rows: ExecPayAcross[] }) {
  return (
    <section aria-labelledby={id}>
      <SectionHead id={id} title={title} sub={sub} />
      <Card pad={false}>
        <ol className="divide-y divide-line">
          {rows.map((e) => (
            <li key={`${e.company_slug}-${e.person_id}`} className="flex items-center justify-between gap-4 px-4 py-2.5">
              <div className="min-w-0">
                <Link href={`/c/${e.company_slug}/pay`} className="font-semibold text-ink hover:text-accent-ink text-[13px]">{e.full_name}</Link>
                <div className="text-[12px] leading-4 text-ink-3 truncate">
                  {e.company_name} · FY{e.first_pay_year}{e.last_pay_year !== e.first_pay_year && <>–FY{e.last_pay_year}</>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="num text-ink font-semibold text-[13px]">{compactMoney(e.pay_per_year)}/yr</div>
                <Signed value={e.annualized_excess} kind="perYear" className="text-[12px]" />
              </div>
            </li>
          ))}
        </ol>
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

function excessCell(e: ExecPayAcross) {
  if (e.annualized_excess != null) return <Signed value={e.annualized_excess} kind="perYear" className="font-semibold" />;
  if (e.relative_return_pp != null) return <><Signed value={e.relative_return_pp} kind="pp" /><span className="text-ink-3 text-[12px]"> under 1 yr</span></>;
  return <span className="text-ink-3">—</span>;
}

function lastName(full: string): string {
  const parts = full.replace(/\(.*?\)/g, "").trim().split(/\s+/);
  return parts[parts.length - 1];
}
