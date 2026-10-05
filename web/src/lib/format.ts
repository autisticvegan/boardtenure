// Display formatting. Dates arrive as ISO 'YYYY-MM-DD' strings and are formatted
// without Date objects so no timezone can shift them.

export type Precision = "day" | "month" | "year" | "unknown";

const MINUS = "−";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function pct(x: number | null | undefined, digits = 1, signed = true): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const v = x * 100;
  // At 1,000% and above, decimals are noise: "+623,398%".
  const d = Math.abs(v) >= 1000 ? 0 : digits;
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (s === (0).toFixed(d)) return `${s}%`;
  return `${v < 0 ? MINUS : signed ? "+" : ""}${s}%`;
}

export function pp(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const v = x * 100;
  const s = Math.abs(v).toFixed(digits);
  return `${v < 0 ? MINUS : "+"}${s} pp`;
}

export function money(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `$${x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function compactMoney(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const abs = Math.abs(x);
  if (abs >= 1e12) return `$${(x / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(x / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
  return money(x, 0);
}

/** Sign of a return for color: text color is paired with an explicit +/− sign, never color alone. */
export function tone(x: number | null | undefined): "pos" | "neg" | "flat" {
  if (x == null || !Number.isFinite(x) || Math.abs(x) < 0.0005) return "flat";
  return x > 0 ? "pos" : "neg";
}

export function toneClass(x: number | null | undefined): string {
  const t = tone(x);
  return t === "pos" ? "text-pos" : t === "neg" ? "text-neg" : "text-ink-2";
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return [y, m, d];
}

export function fmtDate(iso: string | null | undefined, precision: Precision = "day"): string {
  if (!iso || precision === "unknown") return "Unknown";
  const [y, m, d] = parts(iso);
  if (precision === "year") return `${y}`;
  if (precision === "month") return `${MONTHS[m - 1]} ${y}`;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m] = parts(iso);
  return `${MONTHS[m - 1]} ${y}`;
}

export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = parts(a);
  const [yb, mb, db] = parts(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "4.2 yrs", "8 mo", "3 wk". Imprecise starts are prefixed with "~". */
export function tenureLength(start: string | null, end: string | null, precision: Precision = "day"): string {
  if (!start || precision === "unknown") return "—";
  const days = daysBetween(start, end ?? todayIso());
  const approx = precision === "day" ? "" : "~";
  if (days >= 365) return `${approx}${(days / 365.25).toFixed(1)} yrs`;
  if (days >= 60) return `${approx}${Math.round(days / 30.44)} mo`;
  return `${approx}${Math.max(1, Math.round(days / 7))} wk`;
}

export function years(days: number | null | undefined): string {
  if (days == null) return "—";
  return `${(days / 365.25).toFixed(1)} yrs`;
}
