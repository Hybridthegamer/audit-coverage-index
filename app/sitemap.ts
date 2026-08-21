import type { MetadataRoute } from "next";

import { getPublishedSlugs } from "@/db/queries/public";
import { absoluteUrl } from "@/lib/site";

/**
 * Sitemap over the published catalog. Reads through the public query layer, so
 * an unpublished or archived protocol can never be advertised to a crawler.
 *
 * Regenerated on the same hourly cadence as the pages it lists.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await getPublishedSlugs();
  const now = new Date();

  return [
    {
      url: absoluteUrl("/"),
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: absoluteUrl("/index"),
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    ...slugs.map((slug) => ({
      url: absoluteUrl(`/protocols/${slug}`),
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
