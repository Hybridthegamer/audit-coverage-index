# Audit Coverage Index

Tracks which DeFi protocols run code their auditors never reviewed. Public
coverage index + private research workspace. See the build SPEC for the full
product; this repo is built in numbered sessions.

**Status: build step 6 complete** — schema and drift engine (1), the bam83
design foundation (2), the public coverage index (3), workspace auth and the
research queue (4), ingest / findings / disclosure (5), and DefiLlama sourcing
(6). Step 7 is on-chain deployment and upgrade data from block explorers, which
is what turns a sourced protocol's `unknown` coverage into a real answer.

## Stack

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
npm run db:seed       # wipe + seed 5 protocols across 3 chains (destructive)
npm run db:source     # sync the curated DefiLlama set (idempotent, additive)
npm run db:ingest     # recompute coverage_state + drift_days, top up the queue
npm test              # vitest unit tests
npx tsc --noEmit      # strict typecheck
```

`db:source` flags: `--dry-run` (fetch and report, write nothing), `--limit=N`
(cap to the N biggest by TVL), `--no-ingest` (skip the recompute afterwards).

## Sourcing (step 6)

`npm run db:source` pulls `https://api.llama.fi/protocols` (free, no key),
curates it, and upserts the result. At the default $1M TVL floor that is ~1,300
protocols out of ~8,100, roughly half of them with no audit on record.

It is **idempotent and additive** — the opposite of `db:seed`. It upserts on
`protocols.slug`, never deletes, and writes only the columns it sourced: a
re-run cannot republish, unpublish, or overwrite a security contact, a bounty,
or a hand-recorded GitHub repo. **Everything it imports stays unpublished**
until you vet it and flip the toggle in `/workspace`.

Curation thresholds are environment variables, all optional:

```
DEFILLAMA_MIN_TVL_USD=1000000     # floor; default 1000000
DEFILLAMA_CATEGORIES=Dexs,Lending # allowlist; default all
DEFILLAMA_CHAINS=Ethereum,Base    # allowlist; default all
DEFILLAMA_INCLUDE_INACTIVE=false  # keep rugged/deprecated/dead rows
DEFILLAMA_MAX_PROTOCOLS=0         # 0 = no cap
```

**What DefiLlama can and cannot answer.** It tells you a protocol exists, what
it holds, and whether anybody audited it — the curation layer. It does not give
reviewed commits, report dates, auditor names, or deployed contract addresses,
so a sourced protocol has no deployment rows and its coverage state stays
`unknown`. That is honest, not a gap: the workspace shows audit presence
(`Audited` / `No audit`) as its own column, distinct from coverage state, and
step 7's on-chain data is what lights the latter up.

## Layout

```
app/
  page.tsx           public home; /coverage is the real /index (see next.config)
  protocols/[slug]/  public detail page + OG image
  workspace/         private research workspace, behind the middleware gate
db/
  schema.ts          10 tables, all enums, relations, the audit_deployments join
  client.ts          server-only Neon HTTP + Drizzle instance
  seed.ts            5 protocols / 5 deployments / 5 audits, all 4 coverage states
  queries/public.ts  the public query surface — the security boundary
  queries/workspace.ts  the private query surface
drizzle/             generated + committed migrations
lib/
  drift.ts           computeDrift() — the single source of truth for drift
  priority.ts        the two private, query-time ranking formulas
  ingest.ts          recompute + queue top-up + the DefiLlama write half
  sources/defillama.ts         fetch + curation policy, pure and testable
  sources/defillama.config.ts  thresholds from the environment
scripts/
  ingest.ts          npm run db:ingest
  source-defillama.ts  npm run db:source
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
