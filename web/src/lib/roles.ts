import type { Membership, Role } from "./queries";

const TITLE_ABBREV: Record<string, string> = {
  "chief executive officer": "CEO",
  "president and chief executive officer": "President & CEO",
  "chief financial officer": "CFO",
  "chief operating officer": "COO",
  president: "President",
};

export function roleLabel(r: Role): string {
  switch (r.role) {
    case "chair": return "Chair";
    case "executive_chair": return "Executive Chair";
    case "vice_chair": return "Vice Chair";
    case "lead_independent_director": return "Lead Independent Director";
    case "executive_director": {
      const t = r.officer_title?.trim();
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
