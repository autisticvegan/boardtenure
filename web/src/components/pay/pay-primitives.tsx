// Money figures for the executive pay page. Signed amounts carry their sign; colour is redundant.
import { compactMoney } from "@/lib/format";

const MINUS = "−";

export function signedMoney(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${x < 0 ? MINUS : "+"}${compactMoney(Math.abs(x))}`;
}

/** Dollars per $1 of pay: "−$84", "+$3.20". */
export function perDollar(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const a = Math.abs(x);
  const s = a >= 100 ? Math.round(a).toLocaleString("en-US") : a.toFixed(a >= 10 ? 1 : 2);
  return `${x < 0 ? MINUS : "+"}$${s}`;
}

export function SignedMoney({ value, per = false, className = "" }: {
  value: number | null | undefined; per?: boolean; className?: string;
}) {
  if (value == null || !Number.isFinite(value)) return <span className={`text-ink-3 ${className}`}>—</span>;
  const tone = value > 0 ? "text-gain-ink" : value < 0 ? "text-loss-ink" : "text-ink-2";
  return <span className={`${tone} num whitespace-nowrap ${className}`}>{per ? perDollar(value) : signedMoney(value)}</span>;
}

/** Pay mix as one bar: cash (salary, bonus, incentive), equity awards, everything else. */
export const PAY_MIX = [
  { key: "cash", label: "Cash: salary, bonus, incentive", color: "var(--series-2)" },
  { key: "equity", label: "Stock and option awards (grant-date value)", color: "var(--series-1)" },
  { key: "other", label: "Other (benefits, perquisites, severance)", color: "var(--bench)" },
] as const;

export type PayMix = { cash: number; equity: number; other: number };

export function payMix(r: {
  salary: number; bonus: number; non_equity_incentive: number; stock_awards: number; option_awards: number;
  pension_nqdc: number; all_other: number;
}): PayMix {
  return {
    cash: r.salary + r.bonus + r.non_equity_incentive,
    equity: r.stock_awards + r.option_awards,
    other: r.pension_nqdc + r.all_other,
  };
}

export function PayMixBar({ mix, max, width = 160 }: { mix: PayMix; max: number; width?: number }) {
  const total = Math.max(0, mix.cash) + Math.max(0, mix.equity) + Math.max(0, mix.other);
  const scale = max > 0 ? width / max : 0;
  return (
    <span aria-hidden className="inline-flex h-2.5 align-middle rounded-sm overflow-hidden bg-surface-3"
          style={{ width }}>
      {total > 0 && PAY_MIX.map((m) => {
        const v = Math.max(0, mix[m.key]);
        return v > 0 ? <span key={m.key} style={{ width: Math.max(1, v * scale), background: m.color }} /> : null;
      })}
    </span>
  );
}

export function PayMixLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] leading-4 text-ink-3">
      {PAY_MIX.map((m) => (
        <li key={m.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: m.color }} />
          {m.label}
        </li>
      ))}
    </ul>
  );
}
