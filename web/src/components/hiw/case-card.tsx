import Link from "next/link";
import { Logo } from "@/components/logo";
import { compactMoney } from "@/lib/format";
import type { ScreenCase } from "@/lib/queries-hiw";
import { HundredBar, hundred } from "./hundred";

/** Tagged names can be footnote markers ("1.") or surnames only; keep the ones that read as names. */
export function ceoNames(names: string[]): string | null {
  const ok = names.filter((n) => /[A-Za-z]{2,}/.test(n) && n.length > 3);
  if (ok.length === 0) return null;
  return ok.length <= 2 ? ok.join(" and ") : `${ok.slice(0, 2).join(", ")} and ${ok.length - 2} more`;
}

export const span = (c: Pick<ScreenCase, "first_frame" | "latest_frame">) =>
  `${c.first_frame.slice(2)}–${c.latest_frame.slice(2)}`;

export function companyLabel(c: Pick<ScreenCase, "entity_name" | "tickers">) {
  const name = c.entity_name.replace(/\s*\/\s*[A-Z]{2}\/?$/, "").replace(/,?\s+(INC|CORP|CORPORATION|HOLDINGS?|CO)\.?$/i, "");
  const titled = name === name.toUpperCase() ? name.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()) : name;
  return { name: titled, ticker: c.tickers?.split(", ")[0] ?? null };
}

export function CaseCard({ c, rank, metric = "pay" }: { c: ScreenCase; rank?: number; metric?: "pay" | "cap" }) {
  const { name, ticker } = companyLabel(c);
  const who = ceoNames(c.ceos);
  const pay = metric === "cap" ? c.peo_cap_sum : c.peo_sct_sum;
  return (
    <Link href={`/case/${c.cik}`}
          className="group block min-w-0 rounded-[14px] border border-line bg-surface px-5 py-4 shadow-card hover:border-line-strong">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">
            {rank != null && <span className="text-accent-ink font-bold mr-1.5">#{rank}</span>}
            {ticker ?? "—"} · {span(c)}
          </div>
          <div className="mt-1 flex items-center gap-2 min-w-0">
            <Logo cik={c.cik} size={26} />
            <span className="text-[16px] leading-6 font-semibold text-ink truncate group-hover:text-accent-ink">{name}</span>
          </div>
          {who && <div className="text-[12px] leading-4 text-ink-3 truncate">CEO: {who}</div>}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[24px] leading-[28px] font-extrabold text-accent-ink num hiw-greedy">{compactMoney(pay)}</div>
          <div className="text-[11px] leading-4 text-ink-3">
            {metric === "cap" ? "CEO pay actually paid" : (ceoNames(c.ceos)?.includes(" and ") ? "to its CEOs" : "to the CEO")}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="flex-1"><HundredBar value={c.tsr_value_of_100} peer={c.peer_tsr_value_of_100} /></span>
        <span className="text-[13px] leading-5 whitespace-nowrap">
          <span className="text-ink-3">$100 became </span>
          <span className={`num font-bold ${c.tsr_value_of_100 < 100 ? "text-loss-ink" : "text-gain-ink"}`}>{hundred(c.tsr_value_of_100)}</span>
        </span>
      </div>
      {c.peer_tsr_value_of_100 != null && (
        <div className="mt-1 text-[11px] leading-4 text-ink-3 text-right">peer group&apos;s $100: {hundred(c.peer_tsr_value_of_100)}</div>
      )}
    </Link>
  );
}
