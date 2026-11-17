import type { Metadata } from "next";
import { View } from "./view";

export const metadata: Metadata = {
  title: "Golden parachutes — paid millions on the way out",
  description: "Severance, accelerated stock, consulting deals, and tax gross-ups handed to departing US executives, itemized from SEC filings beside what $100 of stock became.",
};
export const revalidate = 3600;

export default function Page() {
  return <View kind="all" />;
}
