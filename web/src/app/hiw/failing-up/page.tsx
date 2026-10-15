import type { Metadata } from "next";
import Link from "next/link";
import { hundred } from "@/components/hiw/hundred";
import { Logo } from "@/components/logo";
import { compactMoney } from "@/lib/format";
import { getFailingUp, type FailingUp } from "@/lib/queries-hiw";
import { median } from "@/lib/track-record";

export const metadata: Metadata = { title: "Failing up" };
export const revalidate = 3600;

const KINDS = [
  { key: "all", label: "Everything" },
  { key: "executive", label: "The next big job" },
  { key: "director", label: "A seat on another board" },
] as const;
type Kind = (typeof KINDS)[number]["key"];

const paidSince = (c: FailingUp) => c.pay.reduce((a, p) => a + (p.total ?? 0), 0);

export default async function FailingUpPage({ searchParams }: PageProps<"/hiw/failing-up">) {
  const sp = await searchParams;
  const kind = (KINDS.find((k) => k.key === sp.kind)?.key ?? "all") as Kind;
  const all = await getFailingUp();
  const cases = all.filter((c) => kind === "all" || c.to_kind === kind);
  const seats = all.filter((c) => c.to_kind === "director").length;

  return (
    <div className="space-y-10">
      <header className="max-w-[860px] space-y-4">
        <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-accent-ink">Failing up</div>
        <h1 className="text-[40px] leading-[44px] sm:text-[60px] sm:leading-[62px] font-extrabold tracking-[-0.035em] text-ink">
          Shareholders came up short. They got hired anyway.
        </h1>
        <p className="text-[17px] leading-7 text-ink-2">
          They held a top job at a public company while its shareholders lost at least 40%, or trailed the company&apos;s own chosen
          comparison by 50 points or more. Then another public company hired them{seats > 0 && <> or put them on its board</>},
          and paid them for it.
        </p>
      </header>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-px overflow-hidden rounded-[14px] border border-line bg-line shadow-card">
        <Tile value={String(all.length)} label="people, every one checked filing by filing" />
        <Tile value={hundred(median(all.map((c) => c.from_value_of_100)))} label="the median shareholder's $100, by the first company's own table" />
        <Tile value={hundred(median(all.map((c) => c.comparison_value_of_100)))} label="the same $100 in the comparison the company chose" />
        <Tile value={compactMoney(all.reduce((a, c) => a + paidSince(c), 0))} label="paid by the next company, in the years on file" />
      </dl>

      {seats > 0 && (
        <nav aria-label="Filter by the next role" className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <Link key={k.key} href={k.key === "all" ? "/failing-up" : `/failing-up?kind=${k.key}`} scroll={false}
                  aria-current={kind === k.key ? "true" : undefined}
                  className={`min-h-11 inline-flex items-center rounded-full px-4 text-[13px] font-semibold border transition ${
                    kind === k.key ? "bg-accent text-ink-on-mark border-accent" : "border-line-strong text-ink-2 hover:text-ink"}`}>
              {k.label}
            </Link>
          ))}
        </nav>
      )}

      <ol className="space-y-4">
        {cases.map((c) => <CaseRow key={c.id} c={c} />)}
      </ol>

      <p className="text-[12px] leading-4 text-ink-3 max-w-[80ch]">
        Each window is a cumulative-return table from the first company&apos;s own 10-K or proxy that starts and ends inside
        the person&apos;s tenure; a case was dropped if any other in-tenure table at least as long showed the stock ahead
        of its comparison.
        The next role began after that window ended and within three years of leaving. Pay is the next company&apos;s
        Summary Compensation Table total for executives, or its Director Compensation table total for directors. A strict,
        short list: candidates with ambiguous windows were left out. These are facts about pay and stock; they don&apos;t
        say what any one person caused. <Link href="/about" className="underline underline-offset-2 hover:text-ink-2">How we know</Link>
      </p>
    </div>
  );
}

function CaseRow({ c }: { c: FailingUp }) {
  const seat = c.to_kind === "director";
  const pay = [...c.pay].sort((a, b) => a.fiscal_year - b.fiscal_year);
  return (
    <li className="rounded-[14px] border border-line bg-surface shadow-card overflow-hidden">
      <div className="grid md:grid-cols-[1fr_auto_1fr]">
        <div className="min-w-0 px-5 py-4">
          <div className="flex items-center gap-2 text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">
            <Logo cik={c.from_cik} size={24} />Before · {c.from_company}
          </div>
          <div className="mt-1 text-[18px] leading-6 font-semibold text-ink">{c.person_name}</div>
          <div className="text-[12px] leading-4 text-ink-3">{c.from_role} · {c.from_start?.slice(0, 7)} to {c.from_end?.slice(0, 7)}</div>
          <div className="mt-3 flex items-baseline gap-3">
            <span className={`text-[28px] leading-[32px] font-extrabold num ${c.from_value_of_100 < 100 ? "text-loss-ink" : "text-ink"}`}>{hundred(c.from_value_of_100)}</span>
            <span className="text-[12px] leading-4 text-ink-3">
              from $100, {c.period_start?.slice(0, 7)} to {c.period_end?.slice(0, 7)}<br />
              {c.comparison_name}: {hundred(c.comparison_value_of_100)}
              {c.other_comparisons.map((o) => (
                <span key={o.name} className="block">
                  {o.name}: <span className={o.value_of_100 < c.from_value_of_100 ? "text-ink-2 font-semibold" : ""}>{hundred(o.value_of_100)}</span>
                </span>
              ))}
            </span>
          </div>
          {c.exit_pay_total != null && (
            <div className="mt-2 text-[13px] leading-5 text-ink-2">Left with <strong className="text-accent-ink">{compactMoney(c.exit_pay_total)}</strong></div>
          )}
        </div>
        <div aria-hidden className="hidden md:grid place-items-center px-2 text-[28px] text-accent-ink">→</div>
        <div className="min-w-0 px-5 py-4 border-t md:border-t-0 md:border-l border-line bg-surface-2">
          <div className="flex items-center gap-2 text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">
            <Logo cik={c.to_cik} size={24} />{seat ? "Then a seat on the board of" : "Next"} · {c.to_company}
          </div>
          <div className="mt-1 text-[15px] leading-6 font-semibold text-ink">{c.to_role}</div>
          <div className="text-[12px] leading-4 text-ink-3">from {c.to_start?.slice(0, 7)}</div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
            {pay.filter((p) => p.total > 0).map((p) => (
              <div key={p.fiscal_year}>
                <div className="text-[24px] leading-[28px] font-extrabold text-accent-ink num">{compactMoney(p.total)}</div>
                <div className="text-[12px] leading-4 text-ink-3">{seat ? "for the seat" : "paid"}, FY{p.fiscal_year}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="px-5 py-2 border-t border-line text-[12px] leading-4 text-ink-3">
        {c.exit_description && <>How they left, per the filings: {c.exit_description}. </>}
        Sources:{" "}
        {c.source_urls.map((u, i) => (
          <a key={u} href={u} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink-2 mr-2">{i + 1}</a>
        ))}
      </p>
    </li>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col-reverse justify-end min-w-0 bg-surface px-4 py-3 md:px-5 md:py-4">
      <dt className="mt-0.5 text-[12px] leading-4 text-ink-3">{label}</dt>
      <dd className="text-[26px] leading-[32px] font-extrabold tracking-[-0.01em] text-accent-ink whitespace-nowrap">{value}</dd>
    </div>
  );
}
