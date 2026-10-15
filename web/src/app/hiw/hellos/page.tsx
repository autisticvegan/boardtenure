import type { Metadata } from "next";
import Link from "next/link";
import { MakeItRain } from "@/components/hiw/greed-fx";
import { Receipt } from "@/components/hiw/receipt";
import { compactMoney } from "@/lib/format";
import { fig, getHiwCases, type HiwCase } from "@/lib/queries-hiw";
import { median } from "@/lib/track-record";

export const metadata: Metadata = { title: "Golden hellos" };
export const revalidate = 3600;

const PART_ORDER = ["sign_on_cash", "make_whole_equity", "sign_on_equity", "other_perks"];

/** The welcome package's line items, each under the filing-based label the research gave it. */
const parts = (c: HiwCase) =>
  c.figures.filter((f) => PART_ORDER.includes(f.key) && f.unit === "usd")
    .sort((a, b) => PART_ORDER.indexOf(a.key) - PART_ORDER.indexOf(b.key));

/** What a hire was handed for showing up: a stated total, else the sum of the itemized parts. */
function welcome(c: HiwCase): { total: number | null; stated: boolean } {
  const stated = fig(c, "sign_on_total")?.value;
  if (stated != null) return { total: stated, stated: true };
  const sum = parts(c).reduce((a, f) => a + f.value, 0);
  return { total: sum > 0 ? sum : null, stated: false };
}

/** Shown under the receipt but never added in: parts already inside another line, amounts that were only
 *  possible, a first grant that was the regular annual one, and money handed back later. */
const ASIDES: Record<string, string> = { included_note: "", possible_extra: "not counted", first_annual_grant: "regular pay, not counted" };

/** First-year reported pay: the earliest fiscal year on file. */
const firstYear = (c: HiwCase) =>
  c.figures.filter((f) => f.key === "first_year_pay").sort((a, b) => (a.fiscal_year ?? 0) - (b.fiscal_year ?? 0))[0];

export default async function Hellos() {
  const cases = await getHiwCases("golden_hello");
  const ranked = cases
    .map((c) => ({ c, ...welcome(c), first: firstYear(c) }))
    .sort((a, b) => (b.total ?? b.first?.value ?? 0) - (a.total ?? a.first?.value ?? 0));
  const totals = ranked.map((r) => r.total).filter((x): x is number => x != null);
  const top = ranked[0];

  return (
    <div className="space-y-10">
      <header className="max-w-[860px] space-y-4">
        <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-accent-ink">Golden hellos</div>
        <h1 className="text-[40px] leading-[44px] sm:text-[60px] sm:leading-[62px] font-extrabold tracking-[-0.035em] text-ink">
          Paid to <span className="text-accent-ink hiw-gold-text">show up.</span>
        </h1>
        <p className="text-[17px] leading-7 text-ink-2">
          Before a new CEO has done a day&apos;s work: cash for signing, stock to replace what they left on the table at their
          last job, a grant for joining, and sometimes a jet between home and the office. Every line is from the
          company&apos;s own filings, 2023 onward.
        </p>
        <MakeItRain label="Throw a welcome party" />
      </header>

      {ranked.length === 0 ? (
        <p className="text-ink-2">Research for this section is still being checked against the filings.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-px overflow-hidden rounded-[14px] border border-line bg-line shadow-card">
            <Tile value={String(ranked.length)} label="new CEOs and top executives, 2023 onward" />
            <Tile value={compactMoney(median(totals))} label="the median welcome package, before any regular pay" />
            <Tile value={top ? compactMoney(top.total ?? top.first?.value) : "—"}
                  label={top ? `the biggest: ${top.c.person_name}, ${top.c.company_name}` : "the biggest"} />
          </dl>
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 items-start">
            {ranked.map(({ c, total, stated, first }) => (
              <div key={c.id} className="space-y-2">
                <Receipt
                  title="Welcome receipt"
                  cik={c.cik}
                  company={c.ticker ? `${c.company_name} (${c.ticker})` : c.company_name}
                  person={c.person_name ?? ""}
                  role={c.role ?? ""}
                  left={[c.event_date?.slice(0, 7), c.headline.length < 90 ? `“${c.headline.replace(/^["“']+|["”']+$/g, "")}”` : null].filter(Boolean).join(" · ")}
                  items={parts(c).map((f) => ({ label: f.label, value: f.value }))}
                  total={total}
                  totalStated={stated}
                  basis="actual"
                  value100={fig(c, "value_of_100")?.value ?? null}
                  comparison={fig(c, "comparison_value_of_100")?.label ?? null}
                  comparison100={fig(c, "comparison_value_of_100")?.value ?? null}
                  perMonth={null}
                  sources={c.source_urls}
                  stamp="hired"
                />
                {c.figures.filter((f) => f.key in ASIDES).map((f, i) => (
                  <p key={`a${i}`} className="px-1 text-[12px] leading-4 text-ink-3">
                    {f.label}: {compactMoney(f.value)}{ASIDES[f.key] && ` (${ASIDES[f.key]})`}
                  </p>
                ))}
                {c.figures.filter((f) => f.key === "clawed_back").map((f, i) => (
                  <p key={`c${i}`} className="px-1 text-[12px] leading-4 text-gain-ink font-semibold">
                    ↩ {f.label}: {compactMoney(f.value)}
                  </p>
                ))}
                {c.notes && (
                  <details className="px-1 text-[12px] leading-4 text-ink-3">
                    <summary className="cursor-pointer select-none hover:text-ink-2">Notes on these figures</summary>
                    <p className="mt-1">{c.notes}</p>
                  </details>
                )}
                {first && (
                  <p className="px-1 text-[12px] leading-4 text-ink-3">
                    First-year reported pay{first.fiscal_year ? ` (FY${first.fiscal_year})` : ""}:{" "}
                    <strong className="text-accent-ink">{compactMoney(first.value)}</strong>
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <p className="text-[12px] leading-4 text-ink-3 max-w-[80ch]">
        From offer letters and appointment 8-Ks, inducement-grant filings, and the next proxy&apos;s Summary Compensation
        Table. Stock is valued as the filing values it, usually at the grant date; make-whole awards replace pay the
        person gave up by leaving their last employer. &ldquo;First-year reported pay&rdquo; is the proxy&apos;s total for
        their first fiscal year and can include parts of the welcome package. These are facts about pay; they say nothing
        about the person&apos;s work. <Link href="/about" className="underline underline-offset-2 hover:text-ink-2">How we know</Link>
      </p>
    </div>
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
