// Pay per year (log x) against the stock vs the S&P 500 per year (y), one dot per executive.
// Server-rendered SVG; the table above carries every number, so the chart is labelled as an image.
import { scaleLinear, scaleLog } from "d3-scale";
import { compactMoney } from "@/lib/format";
import { perYear } from "@/lib/standings";

export type ScatterDot = { key: string; name: string; payPerYear: number; excess: number };

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
  const x = scaleLog().domain([Math.min(...pays) / 1.6, Math.max(...pays) * 1.6]).range([M.left, W - M.right]).nice();
  const yd = domainY(dots.map((d) => d.excess));
  const y = scaleLinear().domain([-yd, yd]).range([H - M.bottom, M.top]);
  const xTicks = x.ticks(5).filter((t) => [1, 2, 5].includes(Number(String(t)[0])));
  const yTicks = y.ticks(6);

  // Labels beside their dot: try right then left at growing vertical offsets, avoiding earlier
  // labels and every other dot; fall back to the first candidate.
  type Box = { x0: number; x1: number; y0: number; y1: number };
  const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const pts = dots.map((d) => ({ d, cx: x(d.payPerYear), cy: y(d.excess) }));
  const dotBoxes = pts.map((p) => ({ x0: p.cx - 7, x1: p.cx + 7, y0: p.cy - 7, y1: p.cy + 7 }));
  const placed: Box[] = [];
  const labels = [...pts].sort((a, b) => a.cy - b.cy).map(({ d, cx, cy }) => {
    const w = d.name.length * 6.4;
    const cands: { lx: number; ly: number; anchor: "start" | "end"; box: Box }[] = [];
    for (const step of [0, 1, -1, 2, -2, 3, -3]) {
      for (const side of ["right", "left"] as const) {
        const ly = cy + 4 + step * LABEL_H;
        const x0 = side === "right" ? cx + 9 : cx - 9 - w;
        if (x0 < 2 || x0 + w > W - 2) continue;
        cands.push({ lx: side === "right" ? cx + 9 : cx - 9, ly, anchor: side === "right" ? "start" : "end",
                     box: { x0, x1: x0 + w, y0: ly - 10, y1: ly + 3 } });
      }
    }
    const own = dotBoxes[pts.findIndex((p) => p.d === d)];
    const pick = cands.find((c) => !placed.some((b) => hit(b, c.box))
      && !dotBoxes.some((b) => b !== own && hit(b, c.box))) ?? cands[0];
    placed.push(pick.box);
    return { d, cx, cy, lx: pick.lx, ly: pick.ly, anchor: pick.anchor, leader: Math.abs(pick.ly - (cy + 4)) > 1 };
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
            <text key={`x${t}`} x={x(t)} y={H - M.bottom + 18} textAnchor="middle" fontSize={11} fill="var(--ink-3)">
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
          {labels.map(({ d, cx, cy, lx, ly, anchor, leader }) => {
            const fill = d.excess >= 0 ? "var(--gain)" : "var(--loss)";
            // Dots aren't links: role="img" hides its children, and the table above links every name.
            return (
              <g key={d.key}>
                {leader && <line x1={cx} y1={cy} x2={anchor === "start" ? lx - 2 : lx + 2} y2={ly - 4} stroke="var(--line-strong)" />}
                <circle cx={cx} cy={cy} r={6} fill={fill} stroke="var(--surface)" strokeWidth={1.5} />
                <text x={lx} y={ly} textAnchor={anchor as "start" | "end"} fontSize={11} fill="var(--ink-2)">{d.name}</text>
                <title>{`${d.name}: ${compactMoney(d.payPerYear)} a year; stock ${perYear(d.excess)} vs the S&P 500`}</title>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
