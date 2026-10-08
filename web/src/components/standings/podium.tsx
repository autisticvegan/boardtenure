// Top and Bottom of the table (§5.2 Podium). DOM and visual order are 1, 2, 3; cards reveal 3rd → 2nd → 1st.
import Link from "next/link";
import type { ReactNode } from "react";
import type { RankScope, ScopedDirector } from "@/lib/queries";
import { withScope } from "@/lib/standings";
import { DirectorCard } from "./director-card";

const CAP = 5;
const MIN_FOR_BOTTOM = 6; // fewer ranked: no one sits in both Top and Bottom (§8.3)

export type PodiumRows = { top: ScopedDirector[]; topMore: number; bottom: ScopedDirector[]; bottomMore: number };

/**
 * Top: every SQL rank <= 3 (ties can add cards, capped). Bottom: every row at or below the
 * third-lowest score (rank >= that row's SQL rank), worst first. Ranks are never recomputed.
 */
export function pickPodium(rows: ScopedDirector[]): PodiumRows {
  const topAll = rows.filter((r) => r.rank <= 3);
  let bottomAll: ScopedDirector[] = [];
  if (rows.length >= MIN_FOR_BOTTOM) {
    const worst = [...rows].sort((a, b) => b.rank - a.rank || a.full_name.localeCompare(b.full_name));
    const cut = worst[2].rank;
    bottomAll = worst.filter((r) => r.rank >= cut && r.rank > 3);
  }
  return {
    top: topAll.slice(0, CAP),
    topMore: Math.max(0, topAll.length - CAP),
    bottom: bottomAll.slice(0, CAP),
    bottomMore: Math.max(0, bottomAll.length - CAP),
  };
}

// Static class names so Tailwind sees them: explicit lg placement keeps Top | Bottom columns
// while one shared grid gives every card the same height (1fr rows).
const ROW = ["lg:row-start-1", "lg:row-start-2", "lg:row-start-3", "lg:row-start-4", "lg:row-start-5", "lg:row-start-6", "lg:row-start-7"];
const COL = ["lg:col-start-1", "lg:col-start-2"];

function Head({ id, title, sub }: { id: string; title: string; sub: string }) {
  return (
    <div className="pb-1">
      <h2 id={id} className="text-[20px] leading-[26px] font-bold tracking-[-0.01em] text-ink">{title}</h2>
      <p className="mt-1 text-[13px] leading-5 text-ink-2 max-w-[60ch]">{sub}</p>
    </div>
  );
}

export function Podium({ top, topMore, bottom, bottomMore, scope }: PodiumRows & { scope: RankScope }) {
  const k = Math.max(top.length, bottom.length);
  const cells: ReactNode[] = [];
  const column = (
    col: 0 | 1, variant: "top" | "bottom", rows: ScopedDirector[], more: number, head: ReactNode, moreHref: string,
  ) => {
    const place = (row: number) => `${COL[col]} ${ROW[row] ?? ""}`;
    cells.push(<div key={`${variant}-head`} className={`${place(0)} ${col === 1 ? "max-lg:mt-6" : ""}`}>{head}</div>);
    rows.forEach((d, i) => {
      const delay = Math.max(0, 2 - i) * 80;
      cells.push(
        <div key={`${variant}-${d.slug}`} className={`${place(i + 1)} anim-rise min-w-0`} style={{ animationDelay: `${delay}ms` }}>
          <DirectorCard d={d} variant={variant} scope={scope} glow={variant === "top" && d.rank === 1} />
        </div>,
      );
    });
    if (more > 0) {
      cells.push(
        <p key={`${variant}-more`} className={`${place(k + 1)} text-[13px] leading-5`}>
          <Link href={moreHref} className="text-accent-ink hover:underline underline-offset-2">+{more} more tied →</Link>
        </p>,
      );
    }
  };

  column(0, "top", top, topMore,
    <Head id="top-of-table" title="Top of the table" sub="Stocks that beat the S&P 500 by the most per year during the seat." />,
    withScope("/rankings", scope));
  if (bottom.length > 0) {
    column(1, "bottom", bottom, bottomMore,
      <Head id="bottom-of-table" title="Bottom of the table" sub="Stocks that trailed the S&P 500 by the most per year during the seat." />,
      withScope("/rankings", scope, { dir: "asc" }));
  }

  return (
    <div
      className={`grid grid-cols-1 gap-y-3 gap-x-6 ${bottom.length > 0 ? "lg:grid-cols-2" : ""} lg:[grid-template-rows:var(--podium-rows)]`}
      style={{ ["--podium-rows" as string]: `auto repeat(${Math.max(1, k)}, 1fr)` }}
    >
      {cells}
    </div>
  );
}
