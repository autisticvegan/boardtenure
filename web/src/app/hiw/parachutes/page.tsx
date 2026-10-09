import type { Metadata } from "next";
import { compactMoney, pct } from "@/lib/format";
import { getParachutes } from "@/lib/queries-hiw";

export const metadata: Metadata = { title: "Golden parachutes" };
export const revalidate = 3600;

const TYPE: Record<string, string> = {
  resigned: "resigned", retired: "retired", terminated_without_cause: "terminated without cause",
  terminated_for_cause: "terminated for cause", mutual: "mutual departure", death: "died",
  change_in_control: "change in control", other: "left",
};

export default async function Parachutes() {
  const rows = (await getParachutes()).filter((r) => (r.total_exit_pay ?? 0) > 0);
  return (
    <div className="space-y-8">
      <header className="max-w-[820px] space-y-3">
        <h1 className="text-[36px] leading-[40px] sm:text-[48px] sm:leading-[52px] font-extrabold tracking-[-0.03em] text-ink">Golden parachutes</h1>
        <p className="text-[16px] leading-7 text-ink-2">
          What departing executives received on the way out: severance, stock whose vesting was sped up or continued
          because they left, consulting fees and benefits, as their companies disclosed them. Beside each: how the stock
          did against the S&amp;P 500 while they were an officer.
        </p>
        <p className="text-[12px] leading-4 text-ink-3">
          Companies researched so far: Lyft, Uber, Tesla, NVIDIA, Intel and Netflix. Only amounts a filing states were
          paid or are payable for that departure; hypothetical &ldquo;potential payments&rdquo; aren&apos;t shown.
        </p>
      </header>
      <ol className="space-y-3">
        {rows.map((r) => (
          <li key={`${r.company_slug}-${r.full_name}`} className="rounded-[14px] border border-line bg-surface px-5 py-4 shadow-card">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <div className="min-w-0">
                <div className="text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">
                  {r.company_name} · {r.role} · {TYPE[r.exit_type] ?? r.exit_type}{r.exit_date && ` ${r.exit_date.slice(0, 7)}`}
                </div>
                <div className="mt-1 text-[18px] leading-6 font-semibold text-ink">{r.full_name}</div>
              </div>
              <div className="text-right">
                <div className="text-[28px] leading-[32px] font-extrabold text-accent-ink num">{compactMoney(r.total_exit_pay)}</div>
                <div className="text-[12px] leading-4 text-ink-3">on the way out</div>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-[13px] leading-5">
              <Item label="Severance cash" value={r.severance_cash} />
              <Item label="Stock vesting sped up or kept" value={r.accelerated_equity_value} />
              <Item label="Consulting fees" value={r.consulting_fees} />
              <div>
                <dt className="text-[12px] leading-4 text-ink-3">Stock vs S&amp;P while an officer</dt>
                <dd className={`num font-semibold ${(r.tenure_total_return ?? 0) - (r.tenure_bench_total_return ?? 0) < 0 ? "text-loss-ink" : "text-gain-ink"}`}>
                  {r.tenure_total_return != null ? <>{pct(r.tenure_total_return, 0)} vs {pct(r.tenure_bench_total_return, 0)}</> : "—"}
                </dd>
              </div>
            </dl>
            {r.source_urls?.length > 0 && (
              <p className="mt-2 text-[12px] leading-4 text-ink-3">
                Sources:{" "}
                {r.source_urls.map((u, i) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink-2 mr-2">filing {i + 1}</a>
                ))}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Item({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-[12px] leading-4 text-ink-3">{label}</dt>
      <dd className="num text-ink">{value == null ? <span className="text-ink-3">not stated</span> : compactMoney(value)}</dd>
    </div>
  );
}
