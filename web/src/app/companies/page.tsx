import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { listCompanies } from "@/lib/queries";

export const revalidate = 3600;
export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const companies = await listCompanies();
  return (
    <div className="space-y-6">
      <h1 className="text-[26px] font-semibold tracking-tight">Companies</h1>
      <Card pad={false}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-ink-3 border-b border-line">
              <th className="font-normal px-4 sm:px-5 py-2.5 w-24">Ticker</th>
              <th className="font-normal px-3 py-2.5">Company</th>
              <th className="font-normal px-3 py-2.5 text-right">Current directors</th>
              <th className="font-normal px-4 sm:px-5 py-2.5 text-right">Former tracked</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.slug} className="border-b border-line last:border-0 hover:bg-surface-2">
                <td className="px-4 sm:px-5 py-2.5 font-mono text-[12px] text-ink-2">{c.symbol}</td>
                <td className="px-3 py-2.5"><Link className="font-medium hover:text-accent-ink" href={`/c/${c.slug}`}>{c.common_name}</Link></td>
                <td className="px-3 py-2.5 text-right num">{c.current_directors}</td>
                <td className="px-4 sm:px-5 py-2.5 text-right num">{c.former_directors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
