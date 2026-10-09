import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin", robots: { index: false } };

const NAV = [
  ["/admin", "Overview"],
  ["/admin/issues", "Data issues"],
  ["/admin/filings", "Filings"],
  ["/admin/review", "Review queue"],
  ["/admin/jobs", "Jobs"],
  ["/admin/audit", "Audit log"],
] as const;

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const who = await requireAdmin();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line pb-3">
        <span className="text-[12px] uppercase tracking-wide text-ink-3">Admin</span>
        <nav className="flex flex-wrap gap-4 text-[13px] text-ink-2">
          {NAV.map(([href, label]) => <Link key={href} href={href} className="hover:text-ink">{label}</Link>)}
        </nav>
        <span className="ml-auto text-[12px] text-ink-3">Signed in as {who}</span>
      </div>
      {children}
    </div>
  );
}
