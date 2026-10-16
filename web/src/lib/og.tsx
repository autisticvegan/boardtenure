import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { sql } from "./db";

// Share cards (Open Graph images) for Heads I Win: dark, gold, one big claim and a few figures.
export const OG_SIZE = { width: 1200, height: 630 };

/** A company's icon as a data URI, when it's a format the card renderer can draw. */
export async function logoDataUri(cik: number): Promise<string | null> {
  const rows = await sql<{ file: string | null; content_type: string | null }[]>`
    SELECT file, content_type FROM company_logo WHERE cik = ${cik}`;
  const r = rows[0];
  if (!r?.file || !/^image\/(png|jpeg|gif)$/.test(r.content_type ?? "") || !/^[\w.-]+$/.test(r.file)) return null;
  try {
    const data = await readFile(path.join(process.cwd(), "..", "data", "raw", "logos", r.file));
    return `data:${r.content_type};base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
}

export function card({ kicker, title, stats, logo }: {
  kicker: string; title: string; stats: { value: string; label: string; tone?: "gold" | "loss" | "ink" }[]; logo?: string | null;
}) {
  const color = { gold: "#ffd666", loss: "#ff8a5c", ink: "#f2f4f8" };
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
                    background: "#0b0d12", color: "#f2f4f8", padding: "56px 64px", fontFamily: "Geist" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 52, height: 52, borderRadius: 26, background: "#f5c542", color: "#1a1300", display: "flex",
                        alignItems: "center", justifyContent: "center", fontSize: 30 }}>$</div>
          <div style={{ fontSize: 30, color: "#ffd666" }}>Heads I Win</div>
          <div style={{ fontSize: 24, color: "#8b93a7", marginLeft: 12 }}>{kicker}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          {logo && (
            <div style={{ display: "flex", width: 128, height: 128, borderRadius: 24, background: "#ffffff", alignItems: "center", justifyContent: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- satori renders plain img */}
              <img src={logo} width={100} height={100} style={{ objectFit: "contain" }} alt="" />
            </div>
          )}
          <div style={{ fontSize: title.length > 48 ? 58 : 72, lineHeight: 1.05, letterSpacing: -2, maxWidth: logo ? 900 : 1070, display: "flex" }}>
            {title}
          </div>
        </div>
        <div style={{ display: "flex", gap: 48 }}>
          {stats.map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", maxWidth: 340 }}>
              <div style={{ fontSize: 60, color: color[s.tone ?? "gold"], letterSpacing: -2 }}>{s.value}</div>
              <div style={{ fontSize: 22, color: "#8b93a7" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
