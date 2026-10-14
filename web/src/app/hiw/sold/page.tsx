import type { Metadata } from "next";
import { compactMoney, pct } from "@/lib/format";
import { getExecutiveSales, type ExecSale } from "@/lib/queries-hiw";

export const metadata: Metadata = { title: "What they sold" };
export const revalidate = 3600;

const price = (x: number | null) => (x == null ? "—" : `$${x >= 100 ? Math.round(x).toLocaleString("en-US") : x.toFixed(2)}`);

export default async function Sold() {
  const rows = await getExecutiveSales();
  const avoided = rows.filter((r) => r.value_at_end != null && r.value_at_end < r.proceeds);
  return (
    <div className="space-y-8">
      <header className="max-w-[820px] space-y-3">
        <h1 className="text-[36px] leading-[40px] sm:text-[48px] sm:leading-[52px] font-extrabold tracking-[-0.03em] text-ink">What they sold</h1>
        <p className="text-[16px] leading-7 text-ink-2">
          Stock that named executives sold while they were officers, from their own Form 4 filings, and what the same
          shares were worth when their tenure ended (or at the latest close, if still serving). Where the shares were
          worth less by then, selling banked the difference; shareholders who held on took the full ride.
        </p>
        <p className="text-[12px] leading-4 text-ink-3">
          Companies researched so far: Lyft, Uber, Tesla, NVIDIA, Intel and Netflix. Open-market and private sales only (Form 4
          code S); shares withheld for taxes and gifts aren&apos;t counted. Prices are restated across stock splits. Most
          sales here ran under pre-scheduled 10b5-1 trading plans, set up months ahead; that share is shown for each.
          {avoided.length > 0 && <> For {avoided.length} of the {rows.length} executives, the shares they sold were worth less at the end than they sold them for.</>}
        </p>
      </header>
      <div className="relative overflow-x-auto rounded-[14px] border border-line bg-surface shadow-card" role="region" aria-label="Executive stock sales" tabIndex={0}>
        <table className="w-full min-w-[900px] text-[13px] leading-5">
          <caption className="sr-only">Executive stock sales during their tenure and the value of the same shares at its end.</caption>
          <thead className="text-[12px] leading-4 text-ink-3 text-left">
            <tr className="border-b border-line">
              <th scope="col" className="font-medium px-4 py-3">Executive</th>
              <th scope="col" className="font-medium px-3 py-3 text-right">Sold for</th>
              <th scope="col" className="font-medium px-3 py-3 text-right">Avg price → end price</th>
              <th scope="col" className="font-medium px-3 py-3 text-right">Same shares at the end</th>
              <th scope="col" className="font-medium px-3 py-3 text-right">Stock vs S&amp;P while an officer</th>
              <th scope="col" className="font-medium px-4 py-3 text-right">Via 10b5-1 plans</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => <Row key={`${r.company_slug}-${r.full_name}`} r={r} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ r }: { r: ExecSale }) {
  const diff = r.value_at_end != null ? r.proceeds - r.value_at_end : null;
  return (
    <tr className="border-b border-line last:border-0 align-top">
      <th scope="row" className="font-normal text-left px-4 py-3">
        <span className="font-semibold text-ink">{r.full_name}</span>
        <div className="text-[12px] leading-4 text-ink-3">{r.company_name} · {r.titles[r.titles.length - 1]}</div>
        <div className="text-[12px] leading-4 text-ink-3">{r.window_start} – {r.is_current ? "present" : r.window_end} · {r.filings} filings</div>
      </th>
      <td className="px-3 py-3 text-right num font-bold text-accent-ink text-[15px]">{compactMoney(r.proceeds)}</td>
      <td className="px-3 py-3 text-right num text-ink-2">{price(r.avg_price_adj)} → {price(r.end_close_adj)}</td>
      <td className="px-3 py-3 text-right num">
        <span className="text-ink">{compactMoney(r.value_at_end)}</span>
        {diff != null && (
          <div className={`text-[12px] leading-4 ${diff > 0 ? "text-accent-ink" : "text-ink-3"}`}>
            {diff > 0 ? `${compactMoney(diff)} banked by selling` : `${compactMoney(-diff)} more if held`}
          </div>
        )}
      </td>
      <td className="px-3 py-3 text-right num">
        {r.total_return != null ? (
          <span className={(r.total_return - (r.bench_total_return ?? 0)) < 0 ? "text-loss-ink" : "text-gain-ink"}>
            {pct(r.total_return, 0)} vs {pct(r.bench_total_return, 0)}
          </span>
        ) : "—"}
      </td>
      <td className="px-4 py-3 text-right num text-ink-2">{r.plan_share != null ? `${Math.round(r.plan_share * 100)}%` : "—"}</td>
    </tr>
  );
}
