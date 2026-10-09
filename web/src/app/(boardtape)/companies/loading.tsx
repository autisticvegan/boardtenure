import { Busy, TableSkeleton } from "@/components/standings/skeletons";

// Skeleton for /companies (§8.3). This route never calls notFound(), so a loading boundary is safe here.
export default function Loading() {
  return (
    <Busy label="Loading companies…" className="space-y-6">
      <div className="space-y-3">
        <div className="skeleton h-8 w-44" />
        <div className="skeleton h-5 w-full max-w-[560px]" />
        <div className="skeleton h-11 md:h-9 w-full sm:w-72" />
      </div>
      <TableSkeleton rows={12} head={false} />
    </Busy>
  );
}
