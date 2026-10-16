import { companyLabel } from "@/components/hiw/case-card";
import { hundred } from "@/components/hiw/hundred";
import { compactMoney } from "@/lib/format";
import { card, logoDataUri, OG_SIZE } from "@/lib/og";
import { getCompanyPayRatio, getHubIdentity, getPanelYears } from "@/lib/queries-hiw";
import { ratioLabel } from "@/lib/ratio";

export const alt = "CEO pay vs shareholders, from the company's own filings";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image({ params }: { params: Promise<{ cik: string }> }) {
  const cik = Number((await params).cik);
  const who = Number.isInteger(cik) ? await getHubIdentity(cik) : null;
  if (!who) return card({ kicker: "company", title: "Heads I Win", stats: [] });
  const [panel, ratio, logo] = await Promise.all([getPanelYears(cik), getCompanyPayRatio(cik), logoDataUri(cik)]);
  const years = who.implausible ? [] : panel.years;
  const pay = years.reduce((a, y) => a + y.peos.reduce((b, p) => b + (p.sct ?? 0), 0), 0);
  const last = years.at(-1);
  const stats = [
    ...(pay ? [{ value: compactMoney(pay), label: `CEO pay, ${years[0].period_end.slice(0, 4)}–${last!.period_end.slice(0, 4)}` }] : []),
    ...(last?.tsr != null ? [{ value: hundred(last.tsr), label: "what $100 of the stock became", tone: last.tsr < 100 ? ("loss" as const) : ("ink" as const) }] : []),
    ...(ratio ? [{ value: ratioLabel(ratio.ratio), label: "CEO pay over the median worker's" }] : []),
  ];
  return card({ kicker: "from its own SEC filings", title: companyLabel({ entity_name: who.name, tickers: who.tickers }).name, logo, stats });
}
