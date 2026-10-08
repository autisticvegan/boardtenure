import type { Metadata } from "next";
import Link from "next/link";
import { Chip, ScopeToggle, Signed } from "@/components/standings/primitives";
import { Card } from "@/components/ui";
import { todayIso } from "@/lib/format";
import { getBoardStrips, listCompanies } from "@/lib/queries";
import { CHIP_HINT, isNewCompany, parseScope, SCOPE_LABEL, withScope } from "@/lib/standings";

// Prices are daily closes; a day-long cache is fresh enough.
export const revalidate = 86400;
export const metadata: Metadata = { title: "Companies" };

const TH = "py-2.5 text-[11px] leading-[14px] font-semibold uppercase tracking-[0.08em] text-ink-3 whitespace-nowrap";

export default async function CompaniesPage({ searchParams }: PageProps<"/companies">) {
  const scope = parseScope(await searchParams);
  const [companies, strips] = await Promise.all([listCompanies(), getBoardStrips(scope)]);
  const counts = new Map(companies.map((c) => [c.slug, c]));
  const today = todayIso();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-[26px] leading-8 md:text-[32px] md:leading-[38px] font-bold tracking-[-0.02em] text-ink">Companies</h1>
          <p className="mt-1 text-[13px] leading-5 text-ink-2 max-w-[68ch]">
            Sorted by the median scored seat: how the stock did against the S&amp;P 500 per year during each director seat.
          </p>
        </div>
        <div className="w-full sm:w-auto sm:shrink-0">
          <ScopeToggle scope={scope} hrefFor={(s) => withScope("/companies", s)} note />
        </div>
      </header>

      <Card pad={false}>
        <table className="w-full text-[13px] leading-5">
          <caption className="sr-only">
            Tracked companies sorted by median seat: stock vs S&amp;P 500 per year, {SCOPE_LABEL[scope]}
          </caption>
          <thead>
            <tr className="text-left border-b border-line">
              <th scope="col" className={`${TH} pl-4 sm:pl-5 pr-3 hidden sm:table-cell w-24`}>Ticker</th>
              <th scope="col" className={`${TH} pl-4 sm:pl-3 pr-3`}>Company</th>
              <th scope="col" className={`${TH} px-3 text-right hidden sm:table-cell`}>Seats beat S&amp;P</th>
              <th scope="col" className={`${TH} px-3 text-right`} aria-sort="descending">Median seat</th>
              <th scope="col" className={`${TH} px-3 text-right hidden md:table-cell`}>Current directors</th>
              <th scope="col" className={`${TH} pl-3 pr-4 sm:pr-5 text-right hidden md:table-cell`}>Former tracked</th>
            </tr>
          </thead>
          <tbody className="num">
            {strips.map((c) => {
              const n = counts.get(c.slug);
              const isNew = isNewCompany(c.created_at, today);
              return (
                <tr key={c.slug} className="h-11 border-b border-line last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="pl-4 sm:pl-5 pr-3 py-2.5 font-mono text-[12px] text-ink-2 hidden sm:table-cell">{c.symbol}</td>
                  <td className="pl-4 sm:pl-3 pr-3 py-2.5">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link className="inline-flex items-center max-md:min-h-11 font-medium text-ink hover:text-accent-ink" href={withScope(`/c/${c.slug}`, scope)}>
                        {c.common_name}
                      </Link>
                      <span className="sm:hidden font-mono text-[11px] text-ink-3">{c.symbol}</span>
                      {isNew && <Chip interactive kind="new" label="New" hint={CHIP_HINT.isNew(c.created_at)} />}
                    </span>
                    {/* Below sm the "Seats beat S&P" column folds in here, so the table fits 320px. */}
                    <span className="sm:hidden block text-[12px] leading-4 text-ink-3">
                      {c.scored > 0 ? <>{c.beat} of {c.scored} seats beat the S&amp;P</> : "No scored seats yet"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap hidden sm:table-cell">
                    {c.scored > 0 ? <span className="text-ink-2">{c.beat} of {c.scored}</span> : <span className="text-ink-3">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {c.scored > 0
                      ? <Signed value={c.median_excess} />
                      : <span className="text-[12px] text-ink-3 whitespace-normal"><span className="max-sm:hidden">No scored seats yet</span><span className="sm:hidden" aria-hidden>—</span></span>}
                  </td>
                  <td className="px-3 py-2.5 text-right hidden md:table-cell">{n?.current_directors ?? "—"}</td>
                  <td className="pl-3 pr-4 sm:pr-5 py-2.5 text-right hidden md:table-cell">{n?.former_directors ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
