// Chart series shaping: rebase to cumulative return and downsample.

export type ChartPoint = { d: string; s: number; b: number | null };

/**
 * Rebase stock (s) and benchmark (b) total-return indexes to cumulative returns from
 * `baseDate` (default: the first row), then downsample with largest-triangle-three-buckets
 * on the stock series so peaks and troughs survive. Dates in `keep` are never dropped.
 */
export function normalizeAndAlign(
  rows: { d: string; s: number; b: number | null }[],
  maxPoints: number,
  baseDate?: string,
  keep: string[] = [],
): ChartPoint[] {
  if (rows.length === 0) return [];
  const base = rows.find((r) => !baseDate || r.d >= baseDate) ?? rows[0];
  const out = rows.map((r) => ({
    d: r.d,
    s: r.s / base.s - 1,
    b: r.b != null && base.b != null ? r.b / base.b - 1 : null,
  }));
  const sampled = lttb(out, maxPoints);
  const have = new Set(sampled.map((p) => p.d));
  const extra = out.filter((p) => (keep.includes(p.d) || p.d === base.d) && !have.has(p.d));
  return extra.length ? [...sampled, ...extra].sort((x, y) => (x.d < y.d ? -1 : 1)) : sampled;
}

export function lttb(data: ChartPoint[], threshold: number): ChartPoint[] {
  if (threshold >= data.length || threshold < 3) return data;
  const sampled: ChartPoint[] = [data[0]];
  const every = (data.length - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const avgStart = Math.floor((i + 1) * every) + 1;
    const avgEnd = Math.min(Math.floor((i + 2) * every) + 1, data.length);
    let avgX = 0;
    let avgY = 0;
    for (let j = avgStart; j < avgEnd; j++) {
      avgX += j;
      avgY += data[j].s;
    }
    const len = Math.max(1, avgEnd - avgStart);
    avgX /= len;
    avgY /= len;
    const rangeStart = Math.floor(i * every) + 1;
    const rangeEnd = Math.floor((i + 1) * every) + 1;
    let maxArea = -1;
    let next = rangeStart;
    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs((a - avgX) * (data[j].s - data[a].s) - (a - j) * (avgY - data[a].s));
      if (area > maxArea) {
        maxArea = area;
        next = j;
      }
    }
    sampled.push(data[next]);
    a = next;
  }
  sampled.push(data[data.length - 1]);
  return sampled;
}
