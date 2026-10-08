import { Busy, CardSkeleton } from "@/components/standings/skeletons";

// Skeleton for /methodology (§8.3). This route never calls notFound(), so a loading boundary is safe here.
export default function Loading() {
  return (
    <Busy label="Loading the methodology…" className="max-w-3xl">
      <div className="space-y-3">
        <div className="skeleton h-8 w-48" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-5/6" />
      </div>
      <CardSkeleton lines={5} />
      <CardSkeleton lines={6} />
    </Busy>
  );
}
