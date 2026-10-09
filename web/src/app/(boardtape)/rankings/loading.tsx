// Skeleton for /rankings (§8.3). Shimmer is the only looping motion and stops under reduced motion.
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only" role="status">Loading the standings…</span>
      <div className="space-y-3" aria-hidden>
        <div className="skeleton h-8 w-44" />
        <div className="skeleton h-5 w-full max-w-[560px]" />
        <div className="skeleton h-4 w-48" />
      </div>
      <div className="space-y-3 border-b border-line pb-3" aria-hidden>
        <div className="flex flex-wrap gap-3">
          <div className="skeleton h-11 md:h-9 w-full md:w-44" />
          <div className="skeleton h-11 md:h-9 w-full md:w-72" />
          <div className="skeleton h-11 md:h-9 w-full md:w-40" />
        </div>
        <div className="hidden md:flex gap-3">
          <div className="skeleton h-9 w-56" />
          <div className="skeleton h-9 w-48" />
          <div className="skeleton h-9 w-64" />
        </div>
      </div>
      <div className="skeleton h-5 w-64" aria-hidden />
      <div className="rounded-xl border border-line bg-surface divide-y divide-line" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-3 h-14 md:h-11">
            <div className="skeleton h-7 w-10 shrink-0" />
            <div className="skeleton h-4 flex-1 max-w-[220px]" />
            <div className="skeleton h-4 w-16 shrink-0" />
            <div className="skeleton h-2.5 w-[120px] shrink-0 max-md:hidden" />
            <div className="skeleton h-4 w-24 shrink-0 max-lg:hidden" />
          </div>
        ))}
      </div>
    </div>
  );
}
