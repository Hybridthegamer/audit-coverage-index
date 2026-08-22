# Audit Coverage Index

Tracks which DeFi protocols run code their auditors never reviewed. Public
coverage index + private research workspace. See the build SPEC for the full
product; this repo is built in numbered sessions.

**Status: build complete, steps 1–7** — schema and drift engine (1), the bam83
design foundation (2), the public coverage index (3), workspace auth and the
research queue (4), ingest / findings / disclosure (5), DefiLlama sourcing (6),
and on-chain + audit-report data with the submission generator (7).

Deploying and operating it: **[DEPLOYMENT.md](DEPLOYMENT.md)**.

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

`.env.local` needs one variable to run the app:

```
DATABASE_URL="postgresql://…neon.tech/neondb?sslmode=require"
```

Three more unlock the rest. `WORKSPACE_PASSWORD` + `WORKSPACE_SESSION_SECRET`
gate `/workspace`; `ETHERSCAN_API_KEY` (one Etherscan **V2** key covers every
supported chain) enables on-chain resolution. `GITHUB_TOKEN` is optional and
only raises the audit-discovery rate limit. All are documented in
`.env.local.example`, and all are server-only — none may become `NEXT_PUBLIC_`.

## Commands

```bash
npm run db:generate   # regenerate SQL migrations from db/schema.ts
npm run db:migrate    # apply committed migrations to the Neon branch
npm run db:seed       # wipe + seed 5 protocols across 3 chains (destructive)
npm run db:source     # sync the curated DefiLlama set (idempotent, additive)
npm run db:audits     # walk protocols' GitHub for audit reports
npm run db:onchain    # resolve pinned contracts against Etherscan V2
npm run db:ingest     # recompute coverage_state + drift_days, top up the queue
npm test              # vitest unit tests
npx tsc --noEmit      # strict typecheck
```

`db:source` flags: `--dry-run` (fetch and report, write nothing), `--limit=N`
(cap to the N biggest by TVL), `--no-ingest` (skip the recompute afterwards).

`db:audits` and `db:onchain` flags: `--limit=N`, `--protocol=N` (one protocol),
`--refresh` (re-visit what is already done). `db:audits` also takes
`--no-commits`; `db:onchain` also takes `--no-ingest`.

## Sourcing (step 6)

`npm run db:source` pulls `https://api.llama.fi/protocols` (free, no key),
curates it, and upserts the result. At the default $1M–$50M TVL band that is
~900 protocols out of ~8,100, most of them with no audit on record.

It is **idempotent and additive** — the opposite of `db:seed`. It upserts on
`protocols.slug`, never deletes, and writes only the columns it sourced: a
re-run cannot republish, unpublish, or overwrite a security contact, a bounty,
or a hand-recorded GitHub repo. **Everything it imports stays unpublished**
until you vet it and flip the toggle in `/workspace`.

Curation thresholds are environment variables, all optional:

```
DEFILLAMA_MIN_TVL_USD=1000000     # floor; default 1000000
DEFILLAMA_MAX_TVL_USD=50000000    # ceiling; default 50000000, 0 = none
DEFILLAMA_CATEGORIES=Dexs,Lending # allowlist; default all
DEFILLAMA_CHAINS=Ethereum,Base    # allowlist; default all
DEFILLAMA_INCLUDE_INACTIVE=false  # keep rugged/deprecated/dead rows
DEFILLAMA_MAX_PROTOCOLS=0         # 0 = no cap
```

The ceiling is as deliberate as the floor: above ~$50M the list is centralised
exchanges and blue chips with standing audit relationships, in-house security
teams, and a queue of researchers already on them. The band is where an
unaudited protocol still holding real money actually lives. Lift it with
`DEFILLAMA_MAX_TVL_USD=0`.

**What DefiLlama can and cannot answer.** It tells you a protocol exists, what
it holds, and whether anybody audited it — the curation layer. It does not give
reviewed commits, report dates, auditor names, or deployed contract addresses,
so a sourced protocol has no deployment rows and its coverage state stays
`unknown`. That is honest, not a gap: the workspace shows audit presence
(`Audited` / `No audit`) as its own column, distinct from coverage state, and
step 7's on-chain data is what lights the latter up.

## On-chain data and audit discovery (step 7)

Step 6 curated ~900 protocols but could not say what they had deployed, because
DefiLlama has no contract addresses. Step 7 is the half that does.

```
  db:source   DefiLlama  ->  protocols + coarse audit markers   (curation)
  db:audits   GitHub     ->  audits with real auditor + date    (the audit side)
  db:onchain  Etherscan  ->  deployments, upgrades, proxy facts (the chain side)
      |
  you pin the two commits by hand in /workspace
      |
  db:ingest   -> computeDrift -> coverage_state + drift_days    (the verdict)
```

`db:onchain` resolves a pinned contract against **Etherscan V2** — one API and
one key across Ethereum, Optimism, BNB Chain, Polygon, Base and Arbitrum,
selected by a `chainid` parameter. It records the creation date, whether the
contract sits behind a proxy and which kind (EIP-1967, beacon, legacy
zeppelinos, or the explorer's own flag), the current implementation, the
EIP-1967 admin, whether source is verified, and every `Upgraded(address)` log
as an `upgrade_events` row. Non-EVM chains have no equivalent and are pinned by
hand.

`db:audits` walks a protocol's GitHub for an `audits/` folder — or a repo
*named* `audits`, which several protocols use — and records the auditor and,
where the filename states one, the report date.

### The two commits are yours, not the machine's

`computeDrift()` needs `deployed_commit` and `reviewed_commit`, and **no
external source can supply either**. An explorer has bytecode, never the commit
that produced it. A report filename is not a review scope, and the commit that
*added* a report to a repo is days or weeks after the review it describes.

So step 7 writes facts and refuses assertions:

| Written automatically | Never written |
| --- | --- |
| addresses, `deployed_at`, `last_upgraded_at` | `deployed_commit` |
| `is_upgradeable`, `upgrade_authority`, `source_verified` | `reviewed_commit` |
| `upgrade_events`, `explorer_url` | `audit_deployments` links |
| audit `auditor`, `report_url`, stated `report_date` | |

Discovery leaves a **candidate** commit in the audit's `scope_note`, as prose,
where it cannot be mistaken for a recorded value. You promote it from the target
page, which also marks the audit `verified_by_me` — because filling it in *is*
the verification. Linking an audit to a deployment is the ancestry assertion the
whole public verdict rests on, so nothing automated ever creates one.

A protocol sitting at `unknown` is the system being honest.

## Submissions

`/workspace/findings/<id>/submission` renders the three artefacts of
`vulnerability-submission-template.md` from a recorded finding: initial contact,
full report, fix verification. `lib/submission.ts` is pure and enforces three
things the template alone cannot — **no PoC code ever** (`poc_ref` is a pointer,
there is no `poc_code` column), **missing data is loud** (every gap becomes a
`[TODO: …]` marker and is listed in a banner), and **nothing is inflated**
(severity, funds at risk and the coverage claim render exactly as recorded).

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
  ingest.onchain.ts  the step-7 write half: pin, apply explorer, apply reports
  ingest.sweeps.ts   the step-7 batch drivers + per-item failure policy
  submission.ts      the template, rendered from a finding. Pure.
  sources/defillama.ts         fetch + curation policy, pure and testable
  sources/defillama.config.ts  thresholds from the environment
  sources/explorer.ts          Etherscan V2 across six EVM chains
  sources/explorer.config.ts   key + throttle from the environment
  sources/github.ts            audit-report discovery, pure parsers
  sources/github.config.ts     token + limits from the environment
scripts/
  ingest.ts          npm run db:ingest
  source-defillama.ts  npm run db:source
  onchain.ts         npm run db:onchain
  discover-audits.ts npm run db:audits
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
- **`deployments.drift_score` omitted.** It's in the SPEC column list with no
  defined formula ("nothing weighted"), so it was never created; `drift_days` +
  `coverage_state` are the real public numbers. The only weighted metrics are
  the two private `priority` formulas, computed at query time and never stored.
- **Seed data is illustrative.** Audit dates, commits and TVL are realistic in
  shape but not asserted as current fact — the real ingest (step 5) replaces them.
- **No `poc_code` column**, by design: `findings.poc_ref` is a string pointer only.
