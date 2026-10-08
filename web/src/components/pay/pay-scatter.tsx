// Pay per year (log x) against the stock vs the S&P 500 per year (y), one dot per executive.
// Server-rendered SVG; the table above carries every number, so the chart is labelled as an image.
import { scaleLinear, scaleLog } from "d3-scale";
import { compactMoney } from "@/lib/format";
import { perYear } from "@/lib/standings";

/** label=false draws a small unlabeled dot (crowded cross-company charts); `title` is its hover text. */
export type ScatterDot = { key: string; name: string; payPerYear: number; excess: number; label?: boolean; title?: string };

const W = 760;
const H = 360;
const M = { top: 28, right: 24, bottom: 44, left: 64 };
const LABEL_H = 14;

function domainY(values: number[]): number {
  const m = Math.max(0.1, ...values.map(Math.abs));
  return Math.ceil(m * 10) / 10;
}

export function PayScatter({ dots, medianPay }: { dots: ScatterDot[]; medianPay: number | null }) {
  if (dots.length === 0) return null;
  const pays = dots.map((d) => d.payPerYear);
  // One value 20x above the next (a mega-grant year) would squeeze every other dot into a corner:
  // end the axis past the runner-up and pin the outlier to the right edge with its value.
  const desc = [...pays].sort((a, b) => b - a);
  const cap = desc.length > 2 && desc[0] > 20 * desc[1] ? desc[1] * 2.5 : null;
  const xs = scaleLog().domain([Math.min(...pays) / 1.6, cap ?? Math.max(...pays) * 1.6]).range([M.left, W - M.right - (cap ? 16 : 0)]).nice();
  const x = (v: number) => (cap != null && v > cap ? W - M.right : xs(v));
  const offScale = (v: number) => cap != null && v > cap;
  const yd = domainY(dots.map((d) => d.excess));
  const y = scaleLinear().domain([-yd, yd]).range([H - M.bottom, M.top]);
  const xTicks = xs.ticks(5).filter((t) => [1, 2, 5].includes(Number(String(t)[0])));
  const yTicks = y.ticks(6);

  // Labels beside their dot: try right then left at growing vertical offsets, avoiding earlier
  // labels and every other dot; fall back to the first candidate.
  type Box = { x0: number; x1: number; y0: number; y1: number };
  const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const pts = dots.map((d) => ({ d, cx: x(d.payPerYear), cy: y(d.excess) }));
  const dotBoxes = pts.map((p) => ({ x0: p.cx - 7, x1: p.cx + 7, y0: p.cy - 7, y1: p.cy + 7 }));
  const placed: Box[] = [];
  const unlabeled = pts.filter((p) => p.d.label === false);
  const labels = [...pts].filter((p) => p.d.label !== false).sort((a, b) => a.cy - b.cy).map(({ d, cx, cy }) => {
    const text = offScale(d.payPerYear) ? `${d.name} · ${compactMoney(d.payPerYear)}/yr ›` : d.name;
    const w = text.length * 6.4;
    const cands: { lx: number; ly: number; anchor: "start" | "end"; box: Box }[] = [];
    for (const step of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      for (const side of ["right", "left"] as const) {
        const ly = cy + 4 + step * LABEL_H;
        const x0 = side === "right" ? cx + 9 : cx - 9 - w;
        if (x0 < 2 || x0 + w > W - 2) continue;
        cands.push({ lx: side === "right" ? cx + 9 : cx - 9, ly, anchor: side === "right" ? "start" : "end",
                     box: { x0, x1: x0 + w, y0: ly - 10, y1: ly + 3 } });
      }
    }
    const own = dotBoxes[pts.findIndex((p) => p.d === d)];
    // No clear spot: keep the dot (its hover text names it) rather than overlap another label.
    const pick = cands.find((c) => !placed.some((b) => hit(b, c.box))
      && !dotBoxes.some((b) => b !== own && hit(b, c.box)));
    if (pick) placed.push(pick.box);
    return { d, cx, cy, text, lx: pick?.lx ?? cx, ly: pick?.ly ?? cy, anchor: pick?.anchor ?? "start",
             leader: !!pick && Math.abs(pick.ly - (cy + 4)) > 1, shown: !!pick };
  });

  return (
    <figure className="m-0">
      <div className="relative overflow-x-auto" role="region" aria-label="Pay against the stock chart" tabIndex={0}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[560px] h-auto" role="img"
             aria-label="Each executive's reported pay per year against how the stock did versus the S&P 500 per year over the same window. The table above lists every value.">
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--zero)" : "var(--line)"}
                    strokeWidth={t === 0 ? 1.5 : 1} />
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--ink-3)">
                {t === 0 ? "0" : perYear(t, 0)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={`x${t}`} x={xs(t)} y={H - M.bottom + 18} textAnchor="middle" fontSize={11} fill="var(--ink-3)">
              {compactMoney(t).replace(".0", "")}
            </text>
          ))}
          {medianPay != null && (
            <g>
              <line x1={x(medianPay)} x2={x(medianPay)} y1={M.top} y2={H - M.bottom} stroke="var(--bench)"
                    strokeDasharray="4 4" />
              <text x={x(medianPay) + 4} y={M.top - 8} fontSize={11} fill="var(--ink-3)">median pay</text>
            </g>
          )}
          <text x={W - M.right} y={M.top + 12} textAnchor="end" fontSize={11} fill="var(--ink-3)">▲ stock beat the S&amp;P</text>
          <text x={W - M.right} y={H - M.bottom - 6} textAnchor="end" fontSize={11} fill="var(--ink-3)">▼ stock trailed the S&amp;P</text>
          <text x={(M.left + W - M.right) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--ink-3)">
            Reported pay per year (log scale)
          </text>
          {unlabeled.map(({ d, cx, cy }) => (
            <circle key={d.key} cx={cx} cy={cy} r={4} fill={d.excess >= 0 ? "var(--gain)" : "var(--loss)"} fillOpacity={0.75}
                    stroke="var(--surface)" strokeWidth={1}>
              <title>{d.title ?? `${d.name}: ${compactMoney(d.payPerYear)} a year; stock ${perYear(d.excess)} vs the S&P 500`}</title>
            </circle>
          ))}
          {labels.map(({ d, cx, cy, text, lx, ly, anchor, leader, shown }) => {
            const fill = d.excess >= 0 ? "var(--gain)" : "var(--loss)";
            // Dots aren't links: role="img" hides its children, and the table above links every name.
            return (
              <g key={d.key}>
                {shown && leader && <line x1={cx} y1={cy} x2={anchor === "start" ? lx - 2 : lx + 2} y2={ly - 4} stroke="var(--line-strong)" />}
                <circle cx={cx} cy={cy} r={6} fill={fill} stroke="var(--surface)" strokeWidth={1.5} />
                {shown && <text x={lx} y={ly} textAnchor={anchor as "start" | "end"} fontSize={11} fill="var(--ink-2)">{text}</text>}
                <title>{d.title ?? `${d.name}: ${compactMoney(d.payPerYear)} a year; stock ${perYear(d.excess)} vs the S&P 500`}</title>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
