// A ticker-tape band of real cases. The list is rendered twice so the loop is seamless; screen readers
// get one copy, and hovering pauses it.
import { compactMoney } from "@/lib/format";
import type { ScreenCase } from "@/lib/queries-hiw";
import { companyLabel } from "./case-card";
import { hundred } from "./hundred";

export function Ticker({ cases }: { cases: ScreenCase[] }) {
  if (cases.length === 0) return null;
  const items = cases.map((c) => {
    const { name, ticker } = companyLabel(c);
    return { key: c.cik, label: ticker ?? name, pay: compactMoney(c.peo_sct_sum), tsr: hundred(c.tsr_value_of_100) };
  });
  const row = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined} className="flex shrink-0 items-center">
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-2 px-5 text-[13px] leading-5 whitespace-nowrap border-r border-line">
          <span className="font-mono font-bold text-ink">{i.label}</span>
          <span className="text-ink-3">CEO</span>
          <span className="font-mono font-semibold text-accent-ink">▲ {i.pay}</span>
          <span className="text-ink-3">· $100 →</span>
          <span className="font-mono font-semibold text-loss-ink">▼ {i.tsr}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="hiw-ticker overflow-hidden border-y border-line bg-surface/70 py-2.5" role="region" aria-label="Ticker of cases">
      <div className="hiw-ticker-track">{row(false)}{row(true)}</div>
    </div>
  );
}
