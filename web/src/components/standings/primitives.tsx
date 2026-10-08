// Server-safe primitives for every ranking surface (docs/design/rankings-ui.md §5.1).
import Link from "next/link";
import type { ReactNode } from "react";
import { fmtDate, pct, pp } from "@/lib/format";
import type { RankScope } from "@/lib/queries";
import { perYear, rankLabel, SCOPE_LABEL, SCOPE_NOTE, srRank } from "@/lib/standings";
import { Tooltip } from "./tooltip";

const EPS = 0.0005; // |x| < 0.05% reads as level

// ---- Signed -----------------------------------------------------------------

type SignedKind = "perYear" | "pct" | "pp";
const SIZE: Record<string, string> = {
  table: "",
  xl: "text-[40px] leading-[44px] md:text-[56px] md:leading-[60px] font-extrabold tracking-[-0.03em]",
  l: "text-[32px] leading-[36px] md:text-[40px] md:leading-[44px] font-extrabold tracking-[-0.03em]",
  m: "text-[32px] leading-[36px] font-extrabold tracking-[-0.02em]",
};

/** A signed figure: always carries its sign; colour is redundant, never the only cue. */
export function Signed({ value, kind = "perYear", glyph = false, size = "table", digits = 1, className = "" }: {
  value: number | null | undefined; kind?: SignedKind; glyph?: boolean; size?: keyof typeof SIZE; digits?: number;
  className?: string;
}) {
  if (value == null || !Number.isFinite(value)) return <span className={`text-ink-3 ${className}`}>—</span>;
  const tone = value >= EPS ? "text-gain-ink" : value <= -EPS ? "text-loss-ink" : "text-ink-2";
  const text = kind === "perYear" ? perYear(value, digits) : kind === "pp" ? pp(value, digits) : pct(value, digits);
  const tabular = size === "table" ? "num" : "";
  return (
    <span className={`${tone} ${tabular} ${SIZE[size]} whitespace-nowrap ${className}`}>
      {glyph && Math.abs(value) >= EPS && (
        <span aria-hidden className="inline-block align-middle text-[0.6em] mr-[0.15em] -translate-y-[0.08em]">
          {value > 0 ? "▲" : "▼"}
        </span>
      )}
      {text}
    </span>
  );
}

// ---- RankBadge --------------------------------------------------------------

const MEDAL = ["var(--gold)", "var(--silver)", "var(--bronze)"];
const DISC = { sm: "h-6 min-w-6 text-[12px]", md: "h-7 min-w-7 text-[13px]", lg: "h-9 min-w-9 text-[15px]" };

export function RankBadge({ rank, tie, of, medal = false, size = "md" }: {
  rank: number; tie: boolean; of?: number; medal?: boolean; size?: keyof typeof DISC;
}) {
  const label = rankLabel(rank, tie);
  if (medal && rank <= 3) {
    return (
      <span
        className={`inline-grid place-items-center ${DISC[size]} ${tie ? "px-2 rounded-full" : "rounded-full"} font-bold num text-ink-on-mark shrink-0 whitespace-nowrap`}
        style={{ background: MEDAL[rank - 1] }}
      >
        <span aria-hidden>{tie ? label : rank}</span>
        <span className="sr-only">{srRank(rank, tie, of)}</span>
      </span>
    );
  }
  return (
    <span className="inline-grid place-items-center min-w-10 h-7 px-1.5 rounded-md bg-surface-3 text-ink-2 text-[15px] leading-5 font-bold num shrink-0 whitespace-nowrap">
      <span aria-hidden>{label}</span>
      <span className="sr-only">{srRank(rank, tie, of)}</span>
    </span>
  );
}

// ---- Chip -------------------------------------------------------------------------

export type ChipKind = "short" | "exec" | "ipo" | "current" | "new" | "warming" | "reason" | "tag";

/**
 * A fact chip. By default a plain span: rows and cards are links and links never nest, so the
 * definitions live in ChipKey. `interactive` (only outside links) makes it a button whose hint
 * opens in a Tooltip on hover or focus.
 */
export function Chip({ kind, label, hint, interactive = false, wrap = false }: {
  kind: ChipKind; label: string; hint?: string; interactive?: boolean;
  /** Let a long label wrap (table cells), so the chip never forces the table wider than the page. */
  wrap?: boolean;
}) {
  const base = `inline-flex items-center gap-1 px-2 py-[2px] text-[11px] leading-[14px] font-semibold ${
    wrap ? "rounded-[10px] whitespace-normal" : "rounded-full whitespace-nowrap"}`;
  const look =
    kind === "tag" ? "bg-accent-wash text-accent-ink"
    : kind === "reason" || kind === "warming" ? "bg-surface-3 text-ink-2 border border-dashed border-line-strong"
    : "bg-surface-3 text-ink-2 border border-line-strong";
  // Reason and warming chips lead with "≈" or "·" (§5.1): the label's own "≈", else a "·".
  const lead = (kind === "warming" || kind === "reason") && !label.startsWith("≈");
  const body = (
    <>
      {lead && <span aria-hidden>·</span>}
      {label}
    </>
  );
  if (interactive && hint) {
    return (
      <Tooltip content={<span className="block text-ink-2">{hint}</span>}
               buttonClassName="inline-flex items-center min-h-6 max-md:min-h-11 rounded-full cursor-help">
        <span className={`${base} ${look}`}>{body}</span>
      </Tooltip>
    );
  }
  return <span className={`${base} ${look}`} title={hint}>{body}</span>;
}

// ---- ExcessBar -----------------------------------------------------------------

/** Diverging bar from a centre zero tick; values beyond ±domain end in a notch at the edge. */
export function ExcessBar({ value, domain, size = "sm", width = 120, animate = false, delayMs = 0 }: {
  value: number | null; domain: number; size?: "sm" | "md"; width?: number | "full"; animate?: boolean; delayMs?: number;
}) {
  const h = size === "sm" ? 10 : 14;
  const v = value ?? 0;
  const over = Math.abs(v) > domain;
  const frac = Math.min(1, Math.abs(v) / domain) * 50; // % of full width
  const pos = v >= 0;
  return (
    <span
      aria-hidden
      className="relative inline-block align-middle shrink-0"
      style={{ width: width === "full" ? "100%" : width, height: Math.max(h, 16) }}
    >
      <span className="absolute inset-y-0 left-1/2 w-px bg-zero" />
      {value != null && Math.abs(v) > 0 && (
        <span
          className={`absolute top-1/2 -translate-y-1/2 ${pos ? "bg-gain" : "bg-loss"} ${animate ? "anim-grow" : ""}`}
          style={{
            height: h,
            left: pos ? "50%" : `${50 - frac}%`,
            width: `${frac}%`,
            transformOrigin: pos ? "left center" : "right center",
            animationDelay: animate ? `${delayMs}ms` : undefined,
            borderRadius: over ? 0 : pos ? "0 4px 4px 0" : "4px 0 0 4px",
            clipPath: over
              ? pos ? "polygon(0 0, calc(100% - 6px) 0, 100% 50%, calc(100% - 6px) 100%, 0 100%)"
                    : "polygon(6px 0, 100% 0, 100% 100%, 6px 100%, 0 50%)"
              : undefined,
          }}
        />
      )}
    </span>
  );
}

// ---- ScopeToggle ---------------------------------------------------------------

/**
 * Two-segment scope switch made of links (no client JS). With `sticky` it sticks under the header
 * below md; the note renders after the sticky bar so the bar stays one control tall.
 */
export function ScopeToggle({ scope, hrefFor, note = false, sticky = false }: {
  scope: RankScope; hrefFor: (s: RankScope) => string; note?: boolean; sticky?: boolean;
}) {
  const seg = (s: RankScope) => {
    const active = s === scope;
    return (
      <Link
        key={s}
        href={hrefFor(s)}
        aria-current={active ? "true" : undefined}
        scroll={false}
        className={`grid place-items-center px-3 min-h-11 md:min-h-9 text-[13px] font-semibold whitespace-nowrap rounded-md transition-colors ${
          active ? "bg-surface-3 text-ink shadow-[inset_0_-2px_0_var(--accent)]" : "text-ink-2 hover:text-ink"
        }`}
      >
        {SCOPE_LABEL[s]}
      </Link>
    );
  };
  // Below md the segments split the full width; from md up each keeps its own width.
  return (
    <>
      <div className={sticky ? "md:static sticky z-20 bg-bg/95 backdrop-blur py-2 -mx-4 px-4 sm:-mx-6 sm:px-6 md:mx-0 md:px-0 md:py-0" : ""}
           style={sticky ? { top: "calc(env(safe-area-inset-top, 0px) + 56px)" } : undefined}
           data-sticky-scope={sticky ? "" : undefined}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span aria-hidden className="text-[12px] leading-4 text-ink-3">Seats counted</span>
          <div role="group" aria-label="Seats counted"
               className="inline-flex flex-1 md:flex-none rounded-lg border border-line bg-surface p-0.5 max-md:[&>*]:flex-1">
            {seg("independent")}
            {seg("all")}
          </div>
        </div>
      </div>
      {note && <p className="mt-2 text-[12px] leading-4 text-ink-3 max-w-[60ch]">{SCOPE_NOTE[scope]}</p>}
    </>
  );
}

// ---- AsOf -------------------------------------------------------------------------

export function AsOf({ date, eyebrow = false }: { date: string; eyebrow?: boolean }) {
  return eyebrow
    ? <span className="text-[11px] leading-[14px] uppercase tracking-[0.08em] text-ink-3">Daily closes through {fmtDate(date)}</span>
    : <span className="text-[12px] leading-4 text-ink-3">Daily closes through {fmtDate(date)}</span>;
}

// ---- Section heading --------------------------------------------------------------

export function SectionHead({ title, sub, action, id }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1 mb-4">
      <div className="min-w-0">
        <h2 id={id} className="text-[20px] leading-[26px] font-bold tracking-[-0.01em] text-ink">{title}</h2>
        {sub && <p className="mt-1 text-[13px] leading-5 text-ink-2 max-w-[68ch]">{sub}</p>}
      </div>
      {action && <div className="text-[13px] text-ink-2">{action}</div>}
    </div>
  );
}
