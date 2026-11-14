import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KIND_KEYS, View } from "../view";

export const metadata: Metadata = { title: "Failing up" };
export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return KIND_KEYS.map((kind) => ({ kind }));
}

export default async function Page({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(KIND_KEYS as readonly string[]).includes(kind)) notFound();
  return <View kind={kind} />;
}
