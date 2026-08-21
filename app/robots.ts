import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/site";

/**
 * robots.txt. The public index wants indexing; everything private is excluded
 * here as defence in depth, not as the control — /workspace is gated by real
 * auth in build step 4. A robots directive is a request, not a boundary.
 *
 * /kitchen-sink is the design-system acceptance page, not product; it also
 * carries its own `robots: noindex` metadata. /coverage is the internal path
 * behind the /index rewrite (see next.config.ts) — the indexable URL is
 * /index, so the internal one is kept out of the index as duplicate content.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/workspace", "/workspace/", "/api/", "/kitchen-sink", "/coverage"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
