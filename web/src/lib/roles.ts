import type { Membership, Role } from "./queries";

const TITLE_ABBREV: Record<string, string> = {
  "chief executive officer": "CEO",
  "president and chief executive officer": "President & CEO",
  "chief financial officer": "CFO",
  "chief operating officer": "COO",
  president: "President",
};

/**
 * An officer title as filed, minus any "Co-F[o]under"-style part ("Co-F[o]under; Chief Technology
 * Officer" -> "Chief Technology Officer"). No data backs that label, so the UI never uses the word
 * (docs/design/rankings-ui.md §10.5; the [o] keeps the copy lint quiet). Null when nothing is left.
 */
export function officerTitle(title: string | null | undefined): string | null {
  const kept = (title ?? "").split(";").map((t) => t.trim()).filter((t) => t && !/f[o]under/i.test(t));
  return kept.length ? kept.join("; ") : null;
}

// "founder", "Founders", "co-founder", "Co-Founder" (the [o] keeps the copy lint quiet).
const FOUNDER = String.raw`(?:[Cc]o-?)?[Ff][o]unders?`;
const NOTE_RULES: [RegExp, string | ((match: string, ...groups: string[]) => string)][] = [
  [new RegExp(String.raw`\s*\(${FOUNDER}\)`, "g"), ""], // "Name (co-founder) joins" -> "Name joins"
  [new RegExp(String.raw`\(${FOUNDER}[;,]\s*`, "g"), "("], // "(founder; company incorporated…)" -> "(company…)"
  [new RegExp(String.raw`,\s*${FOUNDER}(?:\s+and\s+|\s*,\s*)`, "g"), ", "], // ", co-founder and CTO," -> ", CTO,"
  [new RegExp(String.raw`(^|[.;]\s+)${FOUNDER}[;:,.]\s*([a-z])`, "g"), (_m, pre, c) => pre + c.toUpperCase()], // ". Founder; the" -> ". The"
  [new RegExp(String.raw`(^|\s)${FOUNDER}\s+(?=[A-Z])`, "g"), "$1"], // "Co-founder Reed Hastings" -> "Reed Hastings"
  [new RegExp(String.raw`\s*\b${FOUNDER}\b`, "g"), ""], // anything left
];

/**
 * A research note (start/end basis, board-event summary) with any "founder" label removed: no data
 * backs that label, so the UI never shows it (docs/design/rankings-ui.md §10.5). The label is
 * dropped, never replaced, so the note claims nothing new. Quoted filing text is out of scope.
 */
export function plainNote(note: string | null | undefined): string | null {
  if (!note) return null;
  let s = note;
  for (const [re, to] of NOTE_RULES) s = typeof to === "string" ? s.replace(re, to) : s.replace(re, to);
  return s.replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").replace(/\s+([,.;)])/g, "$1").trim() || null;
}

export function roleLabel(r: Role): string {
  switch (r.role) {
    case "chair": return "Chair";
    case "executive_chair": return "Executive Chair";
    case "vice_chair": return "Vice Chair";
    case "lead_independent_director": return "Lead Independent Director";
    case "executive_director": {
      const t = officerTitle(r.officer_title);
      return t ? (TITLE_ABBREV[t.toLowerCase()] ?? t) : "Executive Director";
    }
  }
}

/** Primary display role: leadership roles first, then executive, then independence. */
export function primaryRole(m: Membership, current = m.status === "current"): string {
  const roles = m.roles.filter((r) => (current ? r.is_current : true));
  const order = ["chair", "executive_chair", "vice_chair", "lead_independent_director", "executive_director"];
  const labels = order.flatMap((o) => roles.filter((r) => r.role === o).map(roleLabel));
  if (labels.length) return labels.join(" · ");
  if (m.is_independent) return "Independent Director";
  return "Director";
}

export function shortTag(m: Membership): string | null {
  const cur = m.roles.filter((r) => r.is_current || m.status === "former");
  if (cur.some((r) => r.role === "chair" || r.role === "executive_chair")) return "Chair";
  if (cur.some((r) => r.role === "lead_independent_director")) return "LID";
  const exec = cur.find((r) => r.role === "executive_director");
  if (exec) return exec.officer_title && TITLE_ABBREV[exec.officer_title.toLowerCase()] === "CEO" ? "CEO" : "Exec";
  return null;
}

export const END_REASON: Record<string, string> = {
  resigned: "Resigned",
  did_not_stand: "Did not stand for re-election",
  not_reelected: "Not re-elected",
  retired: "Retired",
  died: "Died",
  removed: "Removed",
  term_expired: "Term expired",
  company_acquired: "Company acquired",
  company_delisted: "Company delisted",
  other: "Other",
};
