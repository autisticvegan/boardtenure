// "$100 became $X": the company's own cumulative shareholder return, drawn against the $100 start.
import { compactMoney } from "@/lib/format";

export function hundred(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `$${x >= 1000 ? Math.round(x).toLocaleString("en-US") : x.toFixed(2)}`;
}

export function HundredBar({ value, peer, width = "full" }: { value: number; peer?: number | null; width?: number | "full" }) {
  const max = Math.max(100, value, peer ?? 0);
  const pct = (v: number) => `${Math.max(0.5, (v / max) * 100)}%`;
  return (
    <span aria-hidden className="relative block h-3 rounded-sm bg-surface-3 overflow-hidden" style={{ width: width === "full" ? "100%" : width }}>
      <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: pct(value), background: value < 100 ? "var(--loss)" : "var(--gain)" }} />
      <span className="absolute inset-y-[-2px] w-px bg-ink-2" style={{ left: pct(100) }} title="$100 invested" />
      {peer != null && <span className="absolute inset-y-0 w-0.5 bg-bench" style={{ left: pct(peer) }} />}
    </span>
  );
}

export function PayFigure({ value, label }: { value: number | null; label: string }) {
  return (
    <div>
      <div className="text-[28px] leading-[32px] font-extrabold tracking-[-0.02em] text-accent-ink num">{compactMoney(value)}</div>
      <div className="text-[12px] leading-4 text-ink-3">{label}</div>
    </div>
  );
}
