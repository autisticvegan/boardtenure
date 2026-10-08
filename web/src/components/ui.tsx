import type { ReactNode } from "react";
import { FOOTER_DISCLAIMER } from "@/lib/copy";
import { pct, pp, toneClass } from "@/lib/format";
import type { Perf } from "@/lib/queries";

export function Card({ title, action, children, className = "", pad = true }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`rounded-[14px] border border-line bg-surface shadow-card ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 sm:px-5 pt-4 sm:pt-5 pb-1">
          {title && <h2 className="text-[15px] leading-5 font-[650] text-ink">{title}</h2>}
          {action && <div className="text-[12px] leading-4 text-ink-3">{action}</div>}
        </header>
      )}
      <div className={pad ? `px-4 sm:px-5 pb-4 sm:pb-5 ${title || action ? "pt-2" : "pt-4 sm:pt-5"}` : ""}>{children}</div>
    </section>
  );
}

const STAT_VALUE = {
  default: "text-[22px] leading-7 font-semibold tracking-tight",
  hero: "text-[40px] leading-[44px] font-extrabold tracking-[-0.03em]",
};

export function Stat({ label, value, sub, valueClass = "", size = "default" }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; valueClass?: string; size?: keyof typeof STAT_VALUE;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] leading-4 text-ink-3">{label}</div>
      <div className={`mt-0.5 ${STAT_VALUE[size]} ${valueClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[12px] leading-4 text-ink-3 truncate">{sub}</div>}
    </div>
  );
}

/** Small label. `accent` is UI chrome; `warn` is for data quality only and always carries "!" plus text. */
export function Badge({ children, tone = "neutral", title }: {
  children: ReactNode; tone?: "neutral" | "accent" | "warn"; title?: string;
}) {
  const cls = tone === "accent" ? "bg-accent-wash text-accent-ink"
    : tone === "warn" ? "bg-warn-wash text-warn"
    : "bg-surface-2 text-ink-2";
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium whitespace-nowrap ${cls}`}>
      {tone === "warn" && <span aria-hidden className="font-bold">!</span>}
      {children}
    </span>
  );
}

const CONFIDENCE_HELP: Record<string, string> = {
  high: "Stated explicitly in an SEC filing; quote machine-verified against the document.",
  medium: "Company website or annual report, or inferred from SEC filings (e.g. a 'director since' year).",
  low: "Secondary source or unverified quote. Treat with caution.",
};

export function Confidence({ level }: { level: "high" | "medium" | "low" }) {
  const bars = level === "high" ? 3 : level === "medium" ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-ink-3" title={CONFIDENCE_HELP[level]}>
      <span className="inline-flex items-end gap-px" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={`w-[3px] rounded-[1px] ${i <= bars ? (level === "low" ? "bg-warn" : "bg-ink-2") : "bg-line-strong"}`}
                style={{ height: 4 + i * 2 }} />
        ))}
      </span>
      <span className="capitalize">{level}</span>
      <span className="sr-only"> confidence</span>
    </span>
  );
}

/** A tenure's total return: exact, a range when a date is imprecise, or why it's absent. */
export function TenureReturn({ perf, className = "" }: { perf: Perf | null; className?: string }) {
  if (!perf) return <span className="text-ink-3">—</span>;
  if (perf.status === "ok") {
    return <span className={`num font-medium ${toneClass(perf.total_return)} ${className}`}>{pct(perf.total_return)}</span>;
  }
  if (perf.status === "approximate") {
    return (
      <span className={`num text-ink-2 ${className}`} title="A tenure date is known only to the month or year; the return falls in this range.">
        {pct(perf.return_low, 0)} to {pct(perf.return_high, 0)}
      </span>
    );
  }
  const why = {
    too_short: "Too short to measure",
    no_price_history: "Before listing",
    unknown_dates: "Dates unknown",
    history_gap: "Price history incomplete",
  }[perf.status];
  return <span className="text-ink-3 text-[12px]">{why}</span>;
}

export function Relative({ perf }: { perf: Perf | null }) {
  if (!perf || perf.status !== "ok" || perf.relative_return_pp == null) return <span className="text-ink-3">—</span>;
  return <span className={`num ${toneClass(perf.relative_return_pp)}`}>{pp(perf.relative_return_pp)}</span>;
}

export function Annualized({ perf }: { perf: Perf | null }) {
  if (!perf || perf.status !== "ok") return <span className="text-ink-3">—</span>;
  if (perf.annualized_return == null) {
    return <span className="text-ink-3" title="Not annualized: tenure shorter than one year">—</span>;
  }
  return <span className={`num ${toneClass(perf.annualized_return)}`}>{pct(perf.annualized_return)}</span>;
}

export function Disclaimer({ children }: { children?: ReactNode }) {
  return (
    <p className="text-[12px] text-ink-3 leading-relaxed">
      {children ?? FOOTER_DISCLAIMER}
    </p>
  );
}
