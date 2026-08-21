/**
 * Site-level constants. The public origin is the one value that changes when
 * the custom domain lands, so it lives here and nowhere else — metadataBase,
 * canonical URLs, robots.txt, the sitemap and the absolute OG image URLs all
 * derive from it. Pointing the site at a real domain is a one-line env change,
 * not a code change.
 *
 * Vercel injects VERCEL_PROJECT_PRODUCTION_URL (the stable production
 * hostname, no scheme) on every deployment, so preview builds resolve to
 * something real before a custom domain exists.
 */

function resolveOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}

export const SITE_ORIGIN = resolveOrigin();
export const SITE_URL = new URL(SITE_ORIGIN);

export const SITE_NAME = "Audit Coverage Index";
export const SITE_TAGLINE =
  "Which DeFi protocols run code their auditors never reviewed.";

/** Absolute URL for a site-relative path — OG tags and sitemaps need these. */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE_ORIGIN).toString();
}
