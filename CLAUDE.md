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
- [ ] 2. bam83 foundation: tokens CSS, fonts, grain canvas, custom cursor,
      scroll-reveal observer, typography kitchen-sink page  ← NEXT
- [ ] 3. Public catalog: `/`, `/index`, `/protocols/[slug]`, ISR, OG images,
      robots.txt, custom domain
- [ ] 4. Auth, middleware, `/workspace` queue + target detail
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
