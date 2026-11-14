// Share card for The ratio, at a stable path (/og/ratio.png) a static export can link.
import { companyLabel } from "@/components/hiw/case-card";
import { compactMoney } from "@/lib/format";
import { card, logoDataUri } from "@/lib/og";
import { getPayRatios, getPayRatioStats } from "@/lib/queries-hiw";
import { caughtUpAt, ratioLabel } from "@/lib/ratio";

export const dynamic = "force-static";
export const revalidate = 3600;

export async function GET() {
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
