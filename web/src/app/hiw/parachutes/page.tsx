import type { Metadata } from "next";
import { View } from "./view";

export const metadata: Metadata = { title: "Golden parachutes" };
export const revalidate = 3600;

export default function Page() {
  return <View kind="all" />;
}
