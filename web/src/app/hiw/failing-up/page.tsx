import type { Metadata } from "next";
import { View } from "./view";

export const metadata: Metadata = {
  title: "Failing up — hired again after 40%+ shareholder losses",
  description: "Executives whose previous company lost at least 40% for shareholders (or trailed its own benchmark by 50+ points) and who promptly landed another public-company C-suite job or board seat.",
};
export const revalidate = 3600;

export default function Page() {
  return <View kind="all" />;
}
