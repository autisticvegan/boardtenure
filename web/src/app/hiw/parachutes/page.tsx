import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "@/components/hiw/receipt";
import { compactMoney } from "@/lib/format";
import { getAllChutes, type Chute } from "@/lib/queries-hiw";
import { median } from "@/lib/track-record";

export const metadata: Metadata = { title: "Golden parachutes" };
export const revalidate = 3600;

const KINDS = [
  { key: "all", label: "Everything" },
  { key: "termination", label: "Shown the door" },
  { key: "merger", label: "Sold the company" },
  { key: "resignation", label: "Resigned" },
  { key: "retirement", label: "Retired" },
] as const;
type Kind = (typeof KINDS)[number]["key"];

const STAMP: Record<string, string> = {
  terminated_without_cause: "terminated", terminated_for_cause: "for cause", mutual: "mutual",
  resigned: "resigned", retired: "retired", change_in_control: "sold", death: "died", other: "left",
};

/** Months between two partial dates ("2023-04-17", "2023-04", "2023"); null if either is missing. */
function monthsBetween(a: string | null, b: string | null): number | null {
  const parse = (s: string | null) => {
    const m = s?.match(/^(\d{4})(?:-(\d{2}))?/);
    return m ? Number(m[1]) * 12 + (m[2] ? Number(m[2]) - 1 : 6) : null;
  };
  const x = parse(a), y = parse(b);
  return x != null && y != null && y > x ? y - x : null;
}

const yearOf = (s: string | null) => s?.slice(0, 4) ?? "";
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")}…` : s);

export default async function Parachutes({ searchParams }: PageProps<"/hiw/parachutes">) {
  const sp = await searchParams;
  const kind = (KINDS.find((k) => k.key === sp.kind)?.key ?? "all") as Kind;
  const everything = await getAllChutes();
  const all = everything.filter((c) => (c.total ?? 0) > 0);
  const clawed = everything.filter((c) => c.clawback_or_forfeiture && (kind === "all" || c.context === kind));
  const rows = all.filter((c) => kind === "all" || c.context === kind).sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  const sum = rows.reduce((a, c) => a + (c.total ?? 0), 0);
  const fell = rows.filter((c) => c.value_of_100 != null && c.value_of_100 < 100);
  const trailed = rows.filter((c) => c.value_of_100 != null && c.comparison_value_of_100 != null && c.value_of_100 < c.comparison_value_of_100);
  const top = rows[0];

  return (
    <div className="space-y-10">
      <header className="max-w-[860px] space-y-4">
        <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-accent-ink">Golden parachutes</div>
        <h1 className="text-[40px] leading-[44px] sm:text-[60px] sm:leading-[62px] font-extrabold tracking-[-0.035em] text-ink">
          The exit is the bonus.
        </h1>
        <p className="text-[17px] leading-7 text-ink-2">
          What executives were paid on the way out: severance, stock that kept vesting after they left, consulting
          deals, pensions topped up, taxes covered. Every line is from the company&apos;s own filings, beside what $100 of
          its stock did while they were in charge.
        </p>
      </header>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-px overflow-hidden rounded-[14px] border border-line bg-line shadow-card">
        <Tile value={compactMoney(sum)} label={`paid or promised on the way out, across ${rows.length} exits`} />
        <Tile value={compactMoney(median(rows.map((c) => c.total ?? 0)))} label="the median exit package" />
        <Tile value={top ? compactMoney(top.total) : "—"}
              label={top ? `the biggest: ${top.person}, ${top.company}${top.basis === "estimated" ? " (estimated in the merger filing)" : ""}` : "the biggest"} />
        <Tile value={fell.length ? `${fell.length} of ${rows.filter((c) => c.value_of_100 != null).length}` : "—"}
              label="exits where shareholders' $100 had shrunk while they served" />
      </dl>
      {trailed.length > 0 && (
        <p className="-mt-6 text-[13px] leading-5 text-ink-2">
          In {trailed.length} of these, the stock also trailed the comparison the company itself chose. The package paid out anyway.
        </p>
      )}

      <nav aria-label="Filter by how they left" className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <Link key={k.key} href={k.key === "all" ? "/parachutes" : `/parachutes?kind=${k.key}`} scroll={false}
                aria-current={kind === k.key ? "true" : undefined}
                className={`min-h-11 inline-flex items-center rounded-full px-4 text-[13px] font-semibold border transition ${
                  kind === k.key ? "bg-accent text-ink-on-mark border-accent" : "border-line-strong text-ink-2 hover:text-ink"}`}>
            {k.label}
          </Link>
        ))}
      </nav>

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 items-start">
        {rows.map((c) => <ChuteReceipt key={c.key} c={c} />)}
      </div>

      {clawed.length > 0 && (
        <section aria-labelledby="clawed" className="space-y-4">
          <div>
            <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-gain-ink">The rare exception</div>
            <h2 id="clawed" className="mt-1 text-[28px] leading-8 font-extrabold tracking-[-0.02em] text-ink">Clawed back, forfeited, or left with nothing</h2>
            <p className="mt-1 text-[14px] leading-5 text-ink-2 max-w-[70ch]">
              Sometimes the parachute doesn&apos;t open: pay forfeited on the way out, or money handed back later.
            </p>
          </div>
          <ul className="grid gap-3 md:grid-cols-2">
            {clawed.map((c) => (
              <li key={c.key} className="rounded-[14px] border border-gain/40 bg-surface px-5 py-4 shadow-card">
                <div className="text-[11px] leading-[14px] uppercase tracking-[0.1em] text-ink-3">{c.company} · {yearOf(c.exit_date)}</div>
                <div className="mt-1 text-[16px] leading-6 font-bold text-ink">{c.person}</div>
                <p className="mt-1 text-[13px] leading-5 text-ink-2">{c.clawback_or_forfeiture}</p>
                {c.source_urls[0] && (
                  <a href={c.source_urls[0]} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] text-ink-3 underline underline-offset-2 hover:text-ink-2">source</a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[12px] leading-4 text-ink-3 max-w-[80ch]">
        &ldquo;Estimated&rdquo; packages come from tables a company files before the exit, such as a merger proxy&apos;s golden
        parachute table; the rest are what filings say was paid. Stock vesting is valued as the filing values it. The
        $100 figure is the company&apos;s own shareholder-return table over a window inside the person&apos;s tenure (for the
        companies Boardtape tracks in full, our own measure against SPY). These are facts about pay and stock; they
        don&apos;t say what any one person caused. <Link href="/about" className="underline underline-offset-2 hover:text-ink-2">How we know</Link>
      </p>
    </div>
  );
}

function ChuteReceipt({ c }: { c: Chute }) {
  const months = monthsBetween(c.tenure_start, c.exit_date);
  return (
    <Receipt
      company={c.ticker ? `${c.company} (${c.ticker})` : c.company}
      person={c.person}
      role={c.role}
      left={[c.exit_words ? `“${clip(c.exit_words, 110)}”` : null, yearOf(c.exit_date)].filter(Boolean).join(" · ")}
      items={[
        { label: "Severance", value: c.severance_cash },
        { label: "Bonus on the way out", value: c.bonus },
        { label: "Stock that kept vesting", value: c.equity },
        { label: "Pension / deferred pay", value: c.pension_deferred },
        { label: "Consulting after leaving", value: c.consulting },
        { label: "Benefits and other", value: c.benefits_other },
        { label: "Taxes covered", value: c.tax_gross_up },
      ]}
      total={c.total}
      totalStated={c.total_is_stated}
      basis={c.basis}
      value100={c.value_of_100}
      comparison={c.comparison_name}
      comparison100={c.comparison_value_of_100}
      perMonth={months && c.total ? c.total / months : null}
      sources={c.source_urls}
      stamp={STAMP[c.exit_type] ?? "left"}
    />
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
