# CLAUDE.md

Audit Coverage Index — tracks which DeFi protocols run code their auditors
never reviewed. Public coverage index (indexed, no auth) + private research
workspace (`/workspace/*`, single-user auth). Being built in five sessions.

## Stack

- Next.js 15 (App Router) + TypeScript strict (`noUncheckedIndexedAccess` on)
- Drizzle ORM → Postgres on Neon
- Neon via `@neondatabase/serverless` — the HTTP driver (`drizzle-orm/neon-http`),
  not TCP, because serverless functions can't hold a connection pool
- Vitest for unit tests

### Non-obvious parts

- `db/client.ts` is `server-only`. It throws if imported into a client bundle or
  a plain-Node script. The seed builds its own Neon connection instead of
  importing it; anything running under `tsx`/Node must do the same.
- `DATABASE_URL` lives in `.env.local` (gitignored). `drizzle.config.ts` and the
  seed load it via `dotenv`.

### Drizzle migration workflow

Migrations are committed under `drizzle/` and are the source of truth for the DB.

- `npm run db:generate` — regenerate SQL from `db/schema.ts` after any schema edit
- `npm run db:migrate` — apply committed migrations to the Neon branch
- `npm run db:seed` — wipe + reseed (5 protocols, all four coverage states)
- `npm test` — drift unit tests

Edit the schema, generate, then apply — never hand-edit generated SQL.

## Build order

- [x] 1. Schema, migrations, Neon connection, seed, `computeDrift()` + tests
      (done, commit `0bb2a3c`)
- [x] 2. bam83 foundation: tokens CSS, fonts, grain canvas, custom cursor,
      scroll-reveal observer, typography kitchen-sink page (done, commit `a09bc34`)
- [~] 3. Public catalog: `/`, `/index`, `/protocols/[slug]`, ISR, OG images,
      robots.txt (done). Custom domain is the only piece left — buy it, point
      it at the deploy, then set `NEXT_PUBLIC_SITE_URL`; no code change needed.
- [ ] 4. Auth, middleware, `/workspace` queue + target detail  ← NEXT
- [ ] 5. Ingest modules, findings editor, disclosure timeline

## Locked constraints from step 1

- **10 tables.** protocols, deployments, audits, audit_deployments,
  upgrade_events, leads, outreach_events, queue_items, findings,
  disclosure_events. The SPEC header said "eight" — the header was wrong, the
  schema is correct. `audit_deployments` is the join replacing the jsonb array.
- **`deployments.deployed_at` exists** because an uncovered deployment's drift is
  measured from its deployment date. `last_upgraded_at` is a different column for
  a different thing; do not conflate them.
- **No `drift_score`.** Drift is four discrete states — `current`, `drifted`,
  `uncovered`, `unknown` — nothing weighted. Do not reintroduce a numeric drift
  score without an explicit written formula. (The private `priority_score` is a
  separate, query-time computation, not a stored column.)
- **`computeDrift()` (`lib/drift.ts`) is pure** — no DB, no filesystem, no git.
  Git ancestry arrives as the `isAncestorOfDeployed` boolean on each
  `CandidateAudit`, resolved by the ingest worker and passed in. Never compute
  ancestry inside the function.

## Locked constraints from step 3

- **`/index` is served by a rewrite, not a route.** App Router cannot host a
  route literally named `/index`: Next's `denormalizePagePath` maps that path
  back to `/`, and the build dies with `Cannot read properties of undefined
  (reading 'entryCSSFiles')`. The page lives at `app/coverage/` and
  `next.config.ts` rewrites `/index` → `/coverage`. The public URL stays
  `/index` (canonical tag, sitemap, every internal link); `/coverage` is
  internal and is disallowed in robots.txt. Do not "fix" this by renaming the
  folder to `index`.
- **`db/queries/public.ts` is the security boundary.** Every public route reads
  through it and nothing else; no route imports `db/client` or `db/schema`
  directly. It imports exactly five tables — protocols, deployments, audits,
  audit_deployments, upgrade_events. Adding an import there is a security
  change, not a refactor.
- **Unpublishing is delayed, not immediate.** Public pages are ISR-cached
  (`revalidate = 3600`), so `is_published = false` takes effect at the next
  revalidation or rebuild. Step 5's ingest must call `revalidatePath()` on
  write if visibility changes need to land immediately.
- **OG images run on the edge runtime.** `@vercel/og`'s Node build crashes on
  Windows (`path.join` mangles a `file:///C:/...` URL, so `fileURLToPath`
  throws). Edge also means they render on demand rather than at build.
- **OG fonts come from Google Fonts as TTF.** Satori parses TTF/OTF/WOFF but
  not WOFF2, and the format is content-negotiated from the User-Agent on the
  *font-file* request. `lib/og.ts` asks as Android 2.2 to get TTF, validates
  the magic bytes, and falls back to the bundled default face on any failure.
  A modern UA yields WOFF2 and an MSIE 6 UA yields EOT — both crash Satori.
- **Site origin lives only in `lib/site.ts`**, read from `NEXT_PUBLIC_SITE_URL`
  (falling back to `VERCEL_PROJECT_PRODUCTION_URL`, then localhost).

## Hard constraints

- Design system is **bam83-editorial** (`.claude/skills/bam83-editorial.skill`).
  Do not install shadcn, lucide, or any animation library (Framer Motion, GSAP).
  Radix primitives, unstyled, wrapped in own components.
- `border-radius: 0` everywhere except badge pills and circles.
- Red (`--bam-red`) means one thing only: a deployment drifted from every audit.
  Not decoration.
- The public/private split is a security boundary. No public route, loader, or
  handler may join to findings, disclosure_events, leads, or outreach_events.
- No `poc_code` in the DB. `findings.poc_ref` is a string pointer only.
- Build nothing out of its assigned step: no UI, routes, auth, or ingest until
  the step that owns them.
