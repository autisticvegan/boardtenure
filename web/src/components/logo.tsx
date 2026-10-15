// A company's icon. The image route draws it on its own chip (white, or dark for white marks) and falls
// back to a lettered badge, so every company gets something; wordmarks keep their shape up to 3:1.
export function Logo({ cik, size = 28, className = "" }: { cik: number | string | null | undefined; size?: number; className?: string }) {
  if (cik == null || !/^\d+$/.test(String(cik))) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small same-origin icons; next/image adds nothing here
    <img src={`/api/logo/${Number(cik)}`} alt="" loading="lazy" decoding="async"
         className={`inline-block shrink-0 rounded-[8px] shadow-[0_1px_0_rgba(0,0,0,.25)] ${className}`}
         style={{ height: size, width: "auto", maxWidth: size * 3 }} />
  );
}
