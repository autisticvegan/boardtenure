// Pay-ratio arithmetic shared by the server page and the picker. "If pay arrived evenly through the
// year": the moment the CEO has earned what the median worker makes in a whole year.
const YEAR_HOURS = 365 * 24;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function caughtUpAt(ratio: number): string {
  const hours = YEAR_HOURS / ratio;
  let day = Math.floor(hours / 24);
  const mins = Math.round((hours - day * 24) * 60);
  let h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  if (mins >= 24 * 60) {
    day += 1;
    h = 0;
  }
  let month = 0;
  while (month < 11 && day >= DAYS[month]) {
    day -= DAYS[month];
    month++;
  }
  const ampm = h < 12 ? "a.m." : "p.m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${MONTHS[month]} ${day + 1}, ${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

/** The year a worker earning the median pay would have had to start to match one CEO year by now. */
export function startedIn(ratio: number, now = 2026): string {
  const y = Math.round(now - ratio);
  return y > 0 ? `${y}` : `${Math.abs(y) + 1} BC`;
}

export function ratioLabel(ratio: number): string {
  return `${ratio >= 100 ? Math.round(ratio).toLocaleString("en-US") : ratio.toFixed(ratio < 10 ? 1 : 0)}:1`;
}
