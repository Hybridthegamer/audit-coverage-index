import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/site";

/**
 * robots.txt. Only the landing page is offered for indexing now: it is the
 * door to the private desk and holds no data. Everything private is excluded
 * here as defence in depth, not as the control — /workspace is gated by real
 * auth in build step 4. A robots directive is a request, not a boundary.
 *
 * /index, /coverage and /protocols are the public catalog. It still SERVES —
 * the routes work on a direct URL and still read through db/queries/public.ts,
 * which still applies the published predicate — but nothing links to it since
 * the landing page became the workspace door, and an orphaned page that is
 * still advertised to crawlers is the worst of both. Each of those pages also
 * carries its own `robots: noindex`, because a Disallow only stops the crawl,
 * not an index entry built from inbound links.
 *
 * /kitchen-sink is the design-system acceptance page, not product; it also
 * carries its own `robots: noindex` metadata.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/workspace",
          "/workspace/",
          "/api/",
          "/kitchen-sink",
          "/coverage",
          "/index",
          "/protocols",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
