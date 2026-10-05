"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { asAdmin } from "@/lib/admin-db";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const PRECISIONS = new Set(["day", "month", "year", "unknown"]);
const END_REASONS = new Set(["resigned", "did_not_stand", "not_reelected", "retired", "died", "removed",
  "term_expired", "company_acquired", "company_delisted", "other"]);

export async function setIssueStatus(fd: FormData) {
  const who = await requireAdmin();
  const id = Number(str(fd, "id"));
  const status = str(fd, "status");
  if (!["acknowledged", "resolved", "wont_fix", "open"].includes(status)) throw new Error("bad status");
  const note = str(fd, "note") || `Marked ${status}`;
  await asAdmin(who, note, (tx) => tx`
    UPDATE data_issue SET status = ${status}, resolution_note = ${note},
      resolved_by = ${status === "resolved" || status === "wont_fix" ? `admin:${who}` : null},
      resolved_at = ${status === "resolved" || status === "wont_fix" ? new Date() : null}
    WHERE id = ${id}`);
  revalidatePath("/admin", "layout");
}

export async function markFilingReviewed(fd: FormData) {
  const who = await requireAdmin();
  const accession = str(fd, "accession");
  const note = str(fd, "note");
  await asAdmin(who, note, (tx) => tx`
    UPDATE sec_filing SET processing_status = 'processed', processed_at = now(),
      processor_version = ${`admin:${who}`}, error = ${note}
    WHERE accession_number = ${accession}`);
  revalidatePath("/admin", "layout");
}

export async function reviewFact(fd: FormData) {
  const who = await requireAdmin();
  const id = Number(str(fd, "id"));
  const decision = str(fd, "decision");
  if (!["applied", "rejected", "corroborating"].includes(decision)) throw new Error("bad decision");
  const note = str(fd, "note") || decision;
  await asAdmin(who, note, (tx) => tx`
    UPDATE extracted_fact SET status = ${decision}, reviewed_at = now(), reviewed_by = ${`admin:${who}`}
    WHERE id = ${id}`);
  revalidatePath("/admin", "layout");
}

function partialDate(value: string, precision: string): string | null {
  if (precision === "unknown" || !value) return null;
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) throw new Error(`bad date ${value}`);
  const [y, m = "01", d = "01"] = value.split("-");
  return precision === "year" ? `${y}-01-01` : precision === "month" ? `${y}-${m}-01` : `${y}-${m}-${d}`;
}

export async function updateMembership(fd: FormData) {
  const who = await requireAdmin();
  const id = Number(str(fd, "id"));
  const reason = str(fd, "reason");
  const status = str(fd, "status");
  const sp = str(fd, "start_precision");
  const ep = status === "current" ? null : str(fd, "end_precision");
  if (!["current", "former"].includes(status) || !PRECISIONS.has(sp) || (ep && !PRECISIONS.has(ep))) {
    throw new Error("invalid status or precision");
  }
  const endReason = status === "current" ? null : str(fd, "end_reason") || null;
  if (endReason && !END_REASONS.has(endReason)) throw new Error("invalid end reason");
  const confidence = str(fd, "confidence");
  if (!["high", "medium", "low"].includes(confidence)) throw new Error("invalid confidence");
  await asAdmin(who, reason, (tx) => tx`
    UPDATE board_membership SET
      status = ${status},
      start_date = ${partialDate(str(fd, "start_date"), sp)}, start_precision = ${sp},
      start_basis = ${str(fd, "start_basis") || null},
      end_date = ${ep ? partialDate(str(fd, "end_date"), ep) : null}, end_precision = ${ep},
      end_reason = ${endReason}, confidence = ${confidence},
      notes = ${str(fd, "notes") || null},
      is_locked = ${fd.get("is_locked") === "on"}, review_status = 'reviewed'
    WHERE id = ${id}`);
  revalidatePath("/", "layout");
  redirect(`/admin/memberships/${id}?saved=1`);
}
