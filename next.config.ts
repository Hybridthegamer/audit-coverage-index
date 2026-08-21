import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * The coverage table's public URL is `/index` (build step 3), but App Router
   * cannot host a route by that name: Next's `denormalizePagePath` maps the
   * literal path `/index` back to `/` (legacy Pages Router behaviour), so the
   * build looks up the wrong CSS entry and dies with
   * `Cannot read properties of undefined (reading 'entryCSSFiles')`.
   *
   * So the page lives at `app/coverage/` and is served at `/index` by this
   * rewrite. The URL users and crawlers see is `/index`; `/coverage` is the
   * internal name. Every link in the app points at `/index`, the canonical tag
   * on the page says `/index`, and robots.txt disallows `/coverage` so the
   * internal path is never indexed as duplicate content.
   */
  async rewrites() {
    return [{ source: "/index", destination: "/coverage" }];
  },
};

export default nextConfig;
