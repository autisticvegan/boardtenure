import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { marked } from "marked";

export const metadata: Metadata = { title: "Methodology" };
export const dynamic = "force-static";

// Single source of truth: the repository's docs/methodology.md, rendered at build time.
export default async function MethodologyPage() {
  const md = await readFile(path.join(process.cwd(), "..", "docs", "methodology.md"), "utf8");
  const html = await marked.parse(md);
  return <article className="doc max-w-3xl" dangerouslySetInnerHTML={{ __html: html }} />;
}
