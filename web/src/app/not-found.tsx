import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <p className="text-[12px] text-ink-3 uppercase tracking-wide">Not found</p>
      <h1 className="mt-2 text-[24px] font-semibold tracking-tight">We don&rsquo;t track that page yet</h1>
      <p className="mt-2 text-ink-2">Coverage starts with Lyft and expands company by company.</p>
      <Link href="/" className="inline-block mt-6 text-accent-ink hover:underline">Back to search</Link>
    </div>
  );
}
