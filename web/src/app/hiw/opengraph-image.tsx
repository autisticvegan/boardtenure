import { compactMoney } from "@/lib/format";
import { card, OG_SIZE } from "@/lib/og";
import { getPayRatioStats, getScreenStats } from "@/lib/queries-hiw";
import { getPayAsymmetry } from "@/lib/queries-pay";

export const alt = "Heads I Win: executive pay when shareholders lose";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image() {
  const [stats, ratio, asym] = await Promise.all([getScreenStats(), getPayRatioStats(), getPayAsymmetry()]);
  const down = asym?.buckets_same[0];
  return card({
    kicker: "executive pay vs shareholders",
    title: "Heads, I win. Tails, you lose.",
    stats: [
      { value: compactMoney(stats.median_pay_lost), label: "median CEO pay a year where shareholders lost money" },
      { value: `${Math.round(ratio.median)}×`, label: "the median CEO's pay over the median worker's" },
      ...(down ? [{ value: `${Math.round((down.share_up ?? 0) * 100)}%`, label: "of CEOs got a raise in years the stock fell 40%+", tone: "loss" as const }] : []),
    ],
  });
}
