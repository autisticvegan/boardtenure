import type { MetadataRoute } from "next";

// Pages are indexable; the JSON API and admin are not.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/admin"] }] };
}
