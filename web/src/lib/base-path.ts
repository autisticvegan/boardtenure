// The site's path prefix when exported to a project page (GitHub Pages serves it under /<repo>/).
// next/link adds it to links; plain <img> and fetch URLs need it added by hand.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
