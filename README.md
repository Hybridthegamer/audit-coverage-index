# Audit Coverage Index

Tracks which DeFi protocols run code their auditors never reviewed. Public
coverage index + private research workspace. See the build SPEC for the full
product; this repo is being built in five sessions.

**Status: build step 1 complete** — schema, migrations, Neon connection, seed,
and the drift computation with unit tests. No UI, routes, auth, or ingest yet.

## Stack (this step)

- Next.js 15 (App Router) + TypeScript strict
- Drizzle ORM, migrations committed under `drizzle/`
- Neon Postgres via `@neondatabase/serverless` (HTTP driver, not TCP)
- Vitest for the drift unit tests

## Setup

```bash
npm install
cp .env.local.example .env.local   # then paste your Neon dev-branch URL
```

`.env.local` needs one variable:

```
DATABASE_URL="postgresql://…neon.tech/neondb?sslmode=require"
```

## Commands

```bash
npm run db:generate   # regenerate SQL migrations from db/schema.ts
npm run db:migrate    # apply committed migrations to the Neon branch
npm run db:seed       # wipe + seed 5 protocols across 3 chains
npm test              # vitest: drift unit tests
npx tsc --noEmit      # strict typecheck
```

## Layout

```
app/                 minimal root layout + placeholder page (real UI = step 2/3)
db/
  schema.ts          10 tables, all enums, relations, the audit_deployments join
  client.ts          server-only Neon HTTP + Drizzle instance
  seed.ts            5 protocols / 5 deployments / 5 audits, all 4 coverage states
drizzle/             generated + committed migrations
lib/
  drift.ts           computeDrift() — the single source of truth for drift
  drift.test.ts      covered · drifted · uncovered · unknown
```

## Drift

`computeDrift()` in `lib/drift.ts` is a pure function: no DB, no filesystem, no
`git`. The SPEC's covering-audit rule depends on git ancestry
(`reviewed_commit` is an ancestor of `deployed_commit`), which a pure function
can't decide — so the caller resolves ancestry upstream (git `merge-base` in the
ingest worker, step 5) and passes it in as `isAncestorOfDeployed`. The function
returns `{ coverageState, driftDays }`, which are cached onto `deployments`.

Coverage states:

| state       | meaning                                              |
|-------------|------------------------------------------------------|
| `current`   | covered, no on-chain upgrade since the covering audit |
| `drifted`   | covered, but code changed after the covering audit    |
| `uncovered` | no audit covers the deployed commit                   |
| `unknown`   | commit data missing on either side — stated, not guessed |

## Notes / deviations from the SPEC

- **Table count.** The SPEC header says "Eight tables" but lists **nine**
  (`disclosure_events` is the ninth). With the `audit_deployments` join table
  that replaces `audits.covers_deployment_ids` (jsonb → real many-to-many), the
  total is **10** tables.
- **`deployments.deployed_at` added.** Not in the SPEC column list, but the
  drift rule measures an uncovered deployment "from deployment date", which
  needs a column to live in.
- **`deployments.drift_score` kept but unused.** It's in the SPEC column list
  with no defined formula ("nothing weighted"); `drift_days` + `coverage_state`
  are the real public numbers. Left nullable pending a decision to define or drop.
- **Seed data is illustrative.** Audit dates, commits and TVL are realistic in
  shape but not asserted as current fact — the real ingest (step 5) replaces them.
- **No `poc_code` column**, by design: `findings.poc_ref` is a string pointer only.
