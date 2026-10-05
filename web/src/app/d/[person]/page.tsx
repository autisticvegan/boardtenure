import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RelativeBars, type RelBar } from "@/components/relative-bars";
import { Annualized, Badge, Card, Confidence, Disclaimer, Relative, Stat, TenureReturn } from "@/components/ui";
import { fmtDate, pct, pp, tenureLength, toneClass } from "@/lib/format";
import { getCareer, getDefaultBenchmark, getOtherBoards, getPerson } from "@/lib/queries";
import { primaryRole } from "@/lib/roles";
import { trackRecord } from "@/lib/track-record";

// Data refreshes weekly (historical focus), so a day-long cache is always fresh enough.
export const revalidate = 86400;

export async function generateMetadata({ params }: PageProps<"/d/[person]">): Promise<Metadata> {
  const p = await getPerson((await params).person);
  return p ? { title: `${p.full_name}: board seats & tenure returns` } : {};
}

export default async function DirectorPage({ params }: PageProps<"/d/[person]">) {
  const person = await getPerson((await params).person);
  if (!person) notFound();
  const [career, bench, otherBoards] = await Promise.all([
    getCareer(person.id), getDefaultBenchmark(), getOtherBoards(person.id),
  ]);
  const trackedSlugs = new Set(career.map((s) => s.company_slug));
  const untracked = otherBoards.filter((b) => !b.tracked_slug || !trackedSlugs.has(b.tracked_slug));
  const tr = trackRecord(career);
  const benchName = bench?.name ?? "S&P 500 (SPY)";
  const currentAff = person.affiliations.find((a) => a.is_current);
  const bars: RelBar[] = career
    .filter((s) => s.perf?.status === "ok" && s.perf.relative_return_pp != null)
    .map((s) => ({
      key: String(s.membership_id),
      href: `/c/${s.company_slug}/d/${person.slug}`,
      label: s.company_name,
      sub: `${fmtDate(s.perf!.start_anchor_date)} – ${s.status === "current" ? "present" : fmtDate(s.perf!.end_anchor_date)}`,
      rel: s.perf!.relative_return_pp!,
      total: s.perf!.total_return!,
      bench: s.perf!.bench_total_return!,
    }));

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[12px] text-ink-3 mb-1.5">Director</div>
        <h1 className="text-[26px] sm:text-[30px] font-semibold tracking-tight leading-tight">{person.full_name}</h1>
        <p className="text-ink-2 mt-1 text-[13px]">
          {currentAff ? <>{currentAff.title ? `${currentAff.title}, ` : ""}{currentAff.organization_name}</> : null}
          {person.sec_cik && (
            <>{currentAff ? " · " : ""}<a className="hover:text-ink underline decoration-line-strong underline-offset-2"
                 href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${person.sec_cik}&type=&dateb=&owner=only`}
                 target="_blank" rel="noreferrer">SEC insider filings</a></>
          )}
        </p>
      </div>

      <Card>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-5">
          <Stat label="Board seats tracked" value={tr.seats} sub={`${tr.current} current · ${tr.completed} former`} />
          <Stat label="Median tenure return" value={pct(tr.median_return)} valueClass={toneClass(tr.median_return)}
                sub={tr.measured ? `${tr.measured} measured tenure${tr.measured === 1 ? "" : "s"}` : "none measurable"} />
          <Stat label={`Median vs ${benchName}`} value={pp(tr.median_relative_pp)} valueClass={toneClass(tr.median_relative_pp)}
                sub={tr.relative_n ? `outperformed in ${tr.outperformed} of ${tr.relative_n}` : undefined} />
          <Stat label="Median annualized" value={pct(tr.median_annualized)} valueClass={toneClass(tr.median_annualized)}
                sub={tr.annualized_n ? `${tr.annualized_n} tenure${tr.annualized_n === 1 ? "" : "s"} ≥ 1 year` : "no tenure ≥ 1 year"} />
          <Stat label="Positive / negative" value={tr.measured ? `${tr.positive} / ${tr.negative}` : "—"} />
          <Stat label="Company-years" value={tr.company_years.toFixed(1)} sub="summed across seats" />
        </div>
        {tr.approximate + tr.unmeasured > 0 && (
          <p className="mt-4 text-[12px] text-ink-3">
            Medians use only exactly measured tenures. {tr.approximate > 0 && `${tr.approximate} tenure${tr.approximate === 1 ? " is" : "s are"} shown as a range because a date is imprecise. `}
            {tr.unmeasured > 0 && `${tr.unmeasured} could not be measured (before listing, too short, or dates unknown).`}
          </p>
        )}
      </Card>

      <Card title="Board seats" action={`Benchmark: ${benchName}`} pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[760px]">
            <thead>
              <tr className="text-left text-[12px] text-ink-3 border-b border-line">
                <th className="font-normal px-4 sm:px-5 py-2.5">Company</th>
                <th className="font-normal px-3 py-2.5">Role</th>
                <th className="font-normal px-3 py-2.5">Joined</th>
                <th className="font-normal px-3 py-2.5">Left</th>
                <th className="font-normal px-3 py-2.5">Tenure</th>
                <th className="font-normal px-3 py-2.5 text-right">Return</th>
                <th className="font-normal px-3 py-2.5 text-right">Annualized</th>
                <th className="font-normal px-3 py-2.5 text-right">vs {benchName}</th>
                <th className="font-normal px-4 sm:px-5 py-2.5 text-right">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {career.map((s) => (
                <tr key={s.membership_id} className="border-b border-line last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="px-4 sm:px-5 py-2.5">
                    <Link href={`/c/${s.company_slug}/d/${person.slug}`} className="font-medium text-ink hover:text-accent-ink">{s.company_name}</Link>
                    {s.symbol && <span className="ml-2 font-mono text-[11px] text-ink-3">{s.symbol}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">{primaryRole(s, s.status === "current")}</td>
                  <td className="px-3 py-2.5 text-ink-2 num whitespace-nowrap">
                    {fmtDate(s.start_date, s.start_precision)}
                    {s.perf?.start_anchor_reason === "first_trade" && <> <Badge title="Joined before the stock listed; measured from the first trading day.">pre-IPO</Badge></>}
                  </td>
                  <td className="px-3 py-2.5 text-ink-2 num whitespace-nowrap">{s.status === "current" ? <Badge tone="accent">Current</Badge> : fmtDate(s.end_date, s.end_precision ?? "unknown")}</td>
                  <td className="px-3 py-2.5 text-ink-2 num">{tenureLength(s.start_date, s.end_date, s.start_precision)}</td>
                  <td className="px-3 py-2.5 text-right"><TenureReturn perf={s.perf} /></td>
                  <td className="px-3 py-2.5 text-right"><Annualized perf={s.perf} /></td>
                  <td className="px-3 py-2.5 text-right"><Relative perf={s.perf} /></td>
                  <td className="px-4 sm:px-5 py-2.5 text-right"><Confidence level={s.confidence} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {bars.length > 0 && (
        <Card title={`Each tenure vs ${benchName}`} action="percentage points">
          <RelativeBars rows={bars} benchName={benchName} />
        </Card>
      )}

      {untracked.length > 0 && (
        <Card title="Other public boards named in proxy biographies" action="not yet tracked · unverified">
          <ul className="divide-y divide-line text-[13px]">
            {untracked.map((b) => (
              <li key={b.company} className="py-2 flex flex-wrap justify-between gap-3">
                <span className="text-ink">{b.company}</span>
                <span className="text-ink-3">{b.status === "current" ? "Current" : "Former"}{b.years && !b.years.startsWith("not stated") ? ` · ${b.years}` : ""} · per {b.source_company} proxy</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-ink-3">Listed as disclosed in the company&rsquo;s proxy statement. These seats aren&rsquo;t in the track record until we verify them from that company&rsquo;s own filings.</p>
        </Card>
      )}

      <Card title="Reading this track record">
        <ul className="list-disc pl-5 space-y-1.5 text-[13px] text-ink-2 max-w-3xl">
          <li>Each figure is what the company&rsquo;s stock did while this person held a board seat, not something they caused. Boards act collectively.</li>
          <li>Seats held at the same time share market conditions and aren&rsquo;t independent observations.</li>
          <li>Coverage is only as complete as the companies we track; seats at companies outside our dataset are not shown.</li>
        </ul>
      </Card>
      <Disclaimer />
    </div>
  );
}
