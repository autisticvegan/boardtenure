import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <p className="text-[12px] text-ink-3 uppercase tracking-wide">Not found</p>
      <h1 className="mt-2 text-[24px] font-semibold tracking-tight">We don&rsquo;t have that page</h1>
      <p className="mt-2 text-ink-2">Coverage grows company by company.</p>
      <p className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[14px]">
        <Link href="/" className="inline-flex items-center min-h-11 text-accent-ink hover:underline underline-offset-2">Back to the standings →</Link>
        <Link href="/companies" className="inline-flex items-center min-h-11 text-accent-ink hover:underline underline-offset-2">Browse companies →</Link>
      </p>
    </div>
  );
}
