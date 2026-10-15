import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ExcessBar, SectionHead } from "@/components/standings/primitives";
import { Card } from "@/components/ui";
import { compactMoney } from "@/lib/format";
import { getPayAsymmetry, type AsymBucket, type AsymTerm } from "@/lib/queries-pay";

export const metadata: Metadata = { title: "Does CEO pay fall with the stock?" };
export const revalidate = 3600;

const signedPct = (x: number | null | undefined, digits = 1) =>
  x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(digits)}%`;

function bucketLabel(b: AsymBucket): string {
  const p = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
  if (b.lo == null) return `fell more than ${p(b.hi!)}`;
  if (b.hi == null) return `rose more than ${p(b.lo)}`;
  if (b.hi <= 0) return b.hi === 0 ? `fell up to ${p(b.lo)}` : `fell ${p(b.hi)}–${p(b.lo)}`;
  return b.lo === 0 ? `rose up to ${p(b.hi)}` : `rose ${p(b.lo)}–${p(b.hi)}`;
}

/** "2.8 standard errors" with a plain reading. */
function gapWords(t: AsymTerm): string {
  const z = t.diff_se ? t.diff / t.diff_se : 0;
  const read = Math.abs(z) >= 2 ? "larger than chance would usually produce" : "within what chance could produce";
  return `${Math.abs(z).toFixed(1)} standard errors, ${read}`;
}

export default async function PayAsymmetryPage() {
  const a = await getPayAsymmetry();
  if (!a || !a.same_year.terms) {
    return <p className="text-ink-2">The market-wide pay panel hasn&apos;t been computed yet.</p>;
  }
  const same = a.same_year.terms.ret;
  const both = a.both_years.terms!;
  const two = a.two_year.terms!["ret+ret_prev"];
  const luck = a.luck.terms;
  const domain = Math.max(...a.buckets_same.concat(a.buckets_prior).map((b) => Math.abs(b.median_change ?? 0)), 0.05);
  const worst = a.buckets_same[0];
  const best = a.buckets_same[a.buckets_same.length - 1];

  return (
    <div className="space-y-8 md:space-y-12">
      <header>
        <div className="text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">
          <Link href="/pay" className="hover:text-ink-2">Executive pay</Link> · every company with a pay-versus-performance table
        </div>
        <h1 className="mt-1 text-[26px] leading-8 sm:text-[32px] sm:leading-[38px] font-bold tracking-[-0.02em] text-ink">
          CEO pay rises with the stock. Does it fall with it?
        </h1>
        <p className="mt-2 text-[15px] leading-6 text-ink-2 max-w-[72ch]">
          Since 2023, most US public companies&apos; proxies have set the CEO&apos;s pay beside the company&apos;s total
          shareholder return, year by year, back to fiscal 2020. Taking the same CEO in consecutive years
          ({a.sample.pairs.toLocaleString("en-US")} year-pairs at {a.sample.companies.toLocaleString("en-US")} companies,
          FY{a.sample.first_year - 1}–FY{a.sample.last_year}), this page asks how reported pay changed in good years and
          in bad ones.
        </p>
      </header>

      <p className="text-[17px] leading-7 text-ink max-w-[72ch]">
        {Math.max(Math.abs(same.pay_if_up10), Math.abs(same.pay_if_down10)) < 0.03 ? "Mostly, pay moves little with the stock in either direction" : "Pay moves with the stock"}: about{" "}
        <strong className="font-semibold">{signedPct(same.pay_if_up10)}</strong> with a 10% rise in the year&apos;s return and{" "}
        <strong className="font-semibold">{signedPct(same.pay_if_down10)}</strong> with a 10% fall, a gap of {gapWords(same)}.
        What stands out is the drift: the median CEO&apos;s pay rose {signedPct(a.overall.median_change)} from one year to
        the next, so even in years the stock {bucketLabel(worst)}, the median CEO&apos;s pay{" "}
        {(worst.median_change ?? 0) < 0 ? <>fell only {signedPct(worst.median_change).slice(1)}</> : <>still rose {signedPct(worst.median_change)}</>}.
      </p>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-px overflow-hidden rounded-[14px] border border-line bg-line shadow-card">
        <Tile value={signedPct(a.overall.median_change)}
              label={`median change in the same CEO's pay from the year before (${Math.round((a.overall.share_up ?? 0) * 100)}% were paid more)`} />
        <Tile value={<span className="text-gain-ink">{signedPct(best.median_change)}</span>}
              label={`median change in years the stock ${bucketLabel(best)}`} />
        <Tile value={<span className={(worst.median_change ?? 0) < 0 ? "text-loss-ink" : "text-ink"}>{signedPct(worst.median_change)}</span>}
              label={`in years it ${bucketLabel(worst)}`} />
        <Tile value={`${Math.round((worst.share_up ?? 0) * 100)}%`}
              label={`still paid more than the year before, in years the stock ${bucketLabel(worst)} (${worst.n.toLocaleString("en-US")} CEO-years)`} />
      </dl>

      <section aria-labelledby="same-year">
        <SectionHead id="same-year" title="Pay change by the stock's return that year"
                     sub="Median change in the same CEO's Summary Compensation Table total from the year before, and the share who were paid more." />
        <Card pad={false}><BucketTable buckets={a.buckets_same} domain={domain} label="Stock that year" /></Card>
      </section>

      <section aria-labelledby="prior-year">
        <SectionHead id="prior-year" title="…and by the year before"
                     sub="Stock awards are usually granted early in the year and valued when granted, so the board sets much of a year's reported pay after seeing the previous year's results." />
        <Card pad={false}><BucketTable buckets={a.buckets_prior} domain={domain} label="Stock the year before" /></Card>
      </section>

      <section aria-labelledby="fits">
        <SectionHead id="fits" title="Gains and losses, measured separately"
                     sub="Each row fits the log change in pay to the stock's log return, with gains and losses allowed different slopes, year effects, and standard errors clustered by company." />
        <Card pad={false}>
          <div className="relative overflow-x-auto" role="region" aria-label="Pay response to gains and losses" tabIndex={0}>
            <table className="w-full min-w-[680px] text-[13px] leading-5">
              <caption className="sr-only">Change in reported pay with a 10% rise or fall in the stock, by measure.</caption>
              <thead className="text-[12px] leading-4 text-ink-3 text-left">
                <tr className="border-b border-line">
                  <th scope="col" className="font-medium px-4 py-3">Stock measured over</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Pay with a 10% rise</th>
                  <th scope="col" className="font-medium px-3 py-3 text-right">Pay with a 10% fall</th>
                  <th scope="col" className="font-medium px-4 py-3 text-right">Gap, in standard errors</th>
                </tr>
              </thead>
              <tbody>
                <FitRow label="The same year" t={same} n={a.same_year.n} />
                <FitRow label="The same year (fitted with the year before)" t={both.ret} n={a.both_years.n} />
                <FitRow label="The year before (fitted with the same year)" t={both.ret_prev} n={a.both_years.n} />
                <FitRow label="Both years combined" t={two} n={a.two_year.n} />
                {luck && <FitRow label="The company's peer group (outside the CEO's control)" t={luck.peer_ret} n={a.luck.n} />}
                {luck && <FitRow label="The company beyond its peer group" t={luck.excess} n={a.luck.n} />}
              </tbody>
            </table>
          </div>
        </Card>
        <p className="mt-3 text-[12px] leading-4 text-ink-3 max-w-[80ch]">
          A 10% rise is a log return of ln 1.1, a 10% fall ln 0.9. The peer group is the one each company picks for its own
          table (an index or a list of rivals); &ldquo;beyond its peer group&rdquo; is the company&apos;s return relative
          to it. Pay changes are winsorized at the 1st and 99th percentiles.
          {luck && (
            <> A 10% rise in the peer group&apos;s return, which no CEO controls, went with {signedPct(luck.peer_ret.pay_if_up10)}{" "}
              pay; a 10% rise in the company&apos;s lead over its peers, with {signedPct(luck.excess.pay_if_up10)}.</>
          )}
        </p>
      </section>

      <Card title="Reading these numbers">
        <ul className="space-y-2 text-[13px] leading-5 text-ink-2 list-disc pl-5">
          <li><strong className="text-ink font-semibold">Reported pay</strong> is the Summary Compensation Table total, with
            stock and options valued when granted, not what they were later worth. &ldquo;Compensation actually
            paid&rdquo;, which marks awards to the stock price, moves with the stock by construction, so it isn&apos;t tested
            here.</li>
          <li><strong className="text-ink font-semibold">Same CEO, full years.</strong> Pairs need one CEO for the whole of
            both years, named in the company&apos;s own tags; a new CEO&apos;s first year is left out as a base year (it
            often carries sign-on awards), as is pay under {compactMoney(100_000)}. Companies whose tables show scale
            errors are held out.</li>
          <li><strong className="text-ink font-semibold">The years are short.</strong> Tables began with fiscal 2020 and
            each company&apos;s latest table covers about five years, so this is mostly 2021–2025: one market cycle.</li>
          <li><strong className="text-ink font-semibold">An association, not a mechanism.</strong> Boards change pay for
            many reasons (a promotion to chair, a retention grant, a new plan), and pay and returns can share causes.
            These figures say how pay and the stock moved together, not why.{" "}
            <Link href="/methodology#pay-asymmetry" className="underline underline-offset-2 hover:text-ink">Methodology</Link></li>
        </ul>
      </Card>
    </div>
  );
}

function BucketTable({ buckets, domain, label }: { buckets: AsymBucket[]; domain: number; label: string }) {
  return (
    <div className="relative overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      <table className="w-full min-w-[560px] text-[13px] leading-5">
        <caption className="sr-only">{label}: median change in reported CEO pay and share paid more.</caption>
        <thead className="text-[12px] leading-4 text-ink-3 text-left">
          <tr className="border-b border-line">
            <th scope="col" className="font-medium px-4 py-3">{label}</th>
            <th scope="col" className="font-medium px-3 py-3"><span className="sr-only">Chart</span></th>
            <th scope="col" className="font-medium px-3 py-3 text-right">Median pay change</th>
            <th scope="col" className="font-medium px-3 py-3 text-right">Paid more</th>
            <th scope="col" className="font-medium px-4 py-3 text-right">CEO-years</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={`${b.lo}-${b.hi}`} className="border-b border-line last:border-0">
              <th scope="row" className="font-normal text-left px-4 py-2.5 text-ink whitespace-nowrap">{bucketLabel(b)}</th>
              <td className="px-3 py-2.5"><ExcessBar value={b.median_change} domain={domain} width={160} /></td>
              <td className={`px-3 py-2.5 text-right num font-semibold ${(b.median_change ?? 0) >= 0 ? "text-gain-ink" : "text-loss-ink"}`}>
                {signedPct(b.median_change)}
              </td>
              <td className="px-3 py-2.5 text-right num text-ink-2">{b.share_up == null ? "—" : `${Math.round(b.share_up * 100)}%`}</td>
              <td className="px-4 py-2.5 text-right num text-ink-3">{b.n.toLocaleString("en-US")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FitRow({ label, t, n }: { label: string; t: AsymTerm; n: number }) {
  const ci = (b: number, se: number, x: number) =>
    `${signedPct(Math.exp((b - 1.96 * se) * Math.log(x)) - 1)} to ${signedPct(Math.exp((b + 1.96 * se) * Math.log(x)) - 1)}`;
  const z = t.diff_se ? t.diff / t.diff_se : 0;
  return (
    <tr className="border-b border-line last:border-0 align-top">
      <th scope="row" className="font-normal text-left px-4 py-2.5 text-ink">
        {label}<div className="text-[12px] leading-4 text-ink-3">{n.toLocaleString("en-US")} pairs</div>
      </th>
      <td className="px-3 py-2.5 text-right">
        <div className="num font-semibold text-ink">{signedPct(t.pay_if_up10)}</div>
        <div className="text-[11px] leading-4 text-ink-3 whitespace-nowrap">{ci(t.up, t.up_se, 1.1)}</div>
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="num font-semibold text-ink">{signedPct(t.pay_if_down10)}</div>
        <div className="text-[11px] leading-4 text-ink-3 whitespace-nowrap">{ci(t.down, t.down_se, 0.9).split(" to ").reverse().join(" to ")}</div>
      </td>
      <td className={`px-4 py-2.5 text-right num ${Math.abs(z) >= 2 ? "text-ink font-semibold" : "text-ink-3"}`}>{z.toFixed(1)}</td>
    </tr>
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
