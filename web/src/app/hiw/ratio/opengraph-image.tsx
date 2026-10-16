import { companyLabel } from "@/components/hiw/case-card";
import { compactMoney } from "@/lib/format";
import { card, logoDataUri, OG_SIZE } from "@/lib/og";
import { getPayRatios, getPayRatioStats } from "@/lib/queries-hiw";
import { caughtUpAt, ratioLabel } from "@/lib/ratio";

export const alt = "The ratio: CEO pay against the median worker's";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image() {
  const [rows, stats] = await Promise.all([getPayRatios(), getPayRatioStats()]);
  const top = rows[0];
  return card({
    kicker: "the ratio",
    title: `By ${caughtUpAt(stats.median)}, the CEO has made your whole year.`,
    logo: top ? await logoDataUri(top.cik) : null,
    stats: [
      { value: `${Math.round(stats.median)}:1`, label: "the median CEO's pay over the median worker's" },
      ...(top ? [{ value: ratioLabel(top.ratio), label: `${companyLabel(top).name}: CEO ${compactMoney(top.ceo_pay)}, median worker ${compactMoney(top.median_pay)}` }] : []),
    ],
  });
}
