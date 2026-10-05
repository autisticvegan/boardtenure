import Link from "next/link";
import { SearchBox } from "@/components/search-box";
import { Badge, Card } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { getDataThrough, getRecentEvents, listCompanies } from "@/lib/queries";

// Data refreshes weekly (historical focus), so a day-long cache is always fresh enough.
export const revalidate = 86400;

export default async function Home() {
  const [companies, events, through] = await Promise.all([listCompanies(), getRecentEvents(), getDataThrough()]);
  return (
    <div className="space-y-10">
      <section className="pt-6 sm:pt-12 pb-2 max-w-2xl">
        <h1 className="text-[32px] sm:text-[44px] font-semibold tracking-tight leading-[1.08]">
          What did the stock do while they were on the board?
        </h1>
        <p className="mt-4 text-[15px] text-ink-2 max-w-xl">
          Tenure-by-tenure stock performance for public-company directors, measured against the S&amp;P 500.
          Every date is cited to an SEC filing.
        </p>
        <div className="mt-6">
          <SearchBox size="lg" />
        </div>
        <p className="mt-3 text-[12px] text-ink-3">
          Try <Link className="underline decoration-line-strong underline-offset-2 hover:text-ink-2" href="/c/lyft">Lyft</Link>
          {through && <> · Prices through {fmtDate(through)}</>}
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card title="Companies" action={<Link href="/companies" className="hover:text-ink-2">All companies →</Link>} pad={false}>
          <ul className="divide-y divide-line">
            {companies.slice(0, 12).map((c) => (
              <li key={c.slug}>
                <Link href={`/c/${c.slug}`} className="flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-surface-2 transition-colors">
                  <span className="font-mono text-[12px] w-14 text-ink-2">{c.symbol}</span>
                  <span className="flex-1 font-medium">{c.common_name}</span>
                  <span className="text-[12px] text-ink-3 num">{c.current_directors} directors · {c.former_directors} former</span>
                </Link>
              </li>
            ))}
            {companies.length === 0 && <li className="px-5 py-4 text-ink-3 text-[13px]">No companies loaded yet.</li>}
          </ul>
        </Card>
        <Card title="Recent board changes">
          <ul className="space-y-3">
            {events.map((e) => (
              <li key={e.id} className="text-[13px]">
                <div className="flex items-center gap-2">
                  <Badge tone={e.event_type === "BOARD_JOIN" ? "accent" : "neutral"}>{e.event_type === "BOARD_JOIN" ? "Joined" : "Left"}</Badge>
                  <span className="text-ink-3 num text-[12px]">{fmtDate(e.event_date)}</span>
                </div>
                <div className="mt-0.5">
                  {e.person_slug ? <Link className="hover:text-accent-ink" href={`/c/${e.company_slug}/d/${e.person_slug}`}>{e.full_name}</Link> : null}
                  <span className="text-ink-3"> · </span>
                  <Link className="text-ink-2 hover:text-ink" href={`/c/${e.company_slug}`}>{e.company_name}</Link>
                </div>
              </li>
            ))}
            {events.length === 0 && <li className="text-ink-3 text-[13px]">No changes recorded yet.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
