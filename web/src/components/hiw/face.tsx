/** One side of the coin: what CEO pay did when the stock came up heads (way up) or tails (way down). */
export function Face({ side, tone, title, value, sub }: { side: string; tone: "gain" | "loss"; title: string; value: string; sub: string }) {
  return (
    <div className={`rounded-[18px] border bg-surface px-6 py-6 shadow-card ${tone === "gain" ? "border-gain/40" : "border-loss/40"}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden className="inline-grid place-items-center size-9 rounded-full bg-accent text-ink-on-mark font-black text-[13px]">
          {side[0]}
        </span>
        <div>
          <div className="text-[12px] font-bold uppercase tracking-[0.16em] text-accent-ink">{side}</div>
          <div className="text-[14px] leading-5 text-ink-2">{title}</div>
        </div>
      </div>
      <div className={`mt-4 text-[64px] leading-[64px] font-black tracking-[-0.04em] num ${tone === "gain" ? "text-gain-ink" : "text-ink"}`}>{value}</div>
      <div className="mt-2 text-[13px] leading-5 text-ink-3">{sub}</div>
    </div>
  );
}
