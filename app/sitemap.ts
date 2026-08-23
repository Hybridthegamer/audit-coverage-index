import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/site";

/**
 * Sitemap. One entry: the landing page, which is the only URL this site now
 * offers for indexing.
 *
 * It used to advertise /index and every published protocol slug, read through
 * the public query layer. That catalog still serves on a direct URL, but the
 * landing page no longer links to it and robots.txt now disallows it, so
 * listing it here would be the sitemap contradicting the crawl directive.
 * Restoring it is a matter of putting `getPublishedSlugs()` back — the query
 * and the pages are untouched.
 *
 * No DB read, so this is static rather than hourly-revalidated.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: absoluteUrl("/"),
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
