# CLAUDE.md

Audit Coverage Index — tracks which DeFi protocols run code their auditors
never reviewed. Public coverage index (indexed, no auth) + private research
workspace (`/workspace/*`, single-user auth). Built in numbered sessions;
steps 1–6 are done and step 7 (on-chain deployment data) is next.

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
- `npm run db:seed` — wipe + reseed (5 protocols, all four coverage states).
  DESTRUCTIVE; the only script that truncates.
- `npm run db:source` — sync the curated DefiLlama set. Idempotent + additive;
  flags `--dry-run`, `--limit=N`, `--no-ingest`
- `npm test` — unit tests (drift, priority, ingest planners, DefiLlama source)

Edit the schema, generate, then apply — never hand-edit generated SQL.

## Build order

- [x] 1. Schema, migrations, Neon connection, seed, `computeDrift()` + tests
      (done, commit `0bb2a3c`)
- [x] 2. bam83 foundation: tokens CSS, fonts, grain canvas, custom cursor,
      scroll-reveal observer, typography kitchen-sink page (done, commit `a09bc34`)
- [~] 3. Public catalog: `/`, `/index`, `/protocols/[slug]`, ISR, OG images,
      robots.txt (done). Custom domain is the only piece left — buy it, point
      it at the deploy, then set `NEXT_PUBLIC_SITE_URL`; no code change needed.
- [x] 4. Auth, middleware, `/workspace` queue + target detail (done). Single-user
      cookie gate, private query surface, priority-ranked queue, read-only target
      detail. Queue mutations + findings/disclosure are step 5.
- [x] 5. Ingest modules, findings editor, disclosure timeline (done). Recompute
      pipeline (`lib/ingest.ts`) + CLI (`npm run db:ingest`) + in-app action with
      public revalidation; findings CRUD; disclosure timeline; queue transitions;
      publish toggle.
- [x] 6. DefiLlama sourcing (done). `lib/sources/defillama.ts` + config,
      `syncFromDefiLlama()` in `lib/ingest.ts`, `npm run db:source`, the capped
      in-app sync action, query-time `auditStatus`, and the unpinned-protocol
      table on the queue. Plan doc: `plan.md`.
- [ ] 7. On-chain deployment + upgrade data (NOT started). Block explorers
      (Etherscan/Basescan/Arbiscan) for real contract addresses per chain,
      `deployed_commit`, `last_upgraded_at`, proxy-storage reads and upgrade
      events; plus deeper audit-report discovery (GitHub `/audits` folders,
      reviewed commits, report dates). This is what turns a sourced protocol's
      `unknown` into a real `coverage_state`. Also unstarted: wiring
      `vulnerability-submission-template.md` into a "generate submission"
      action off a finding.

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

## Locked constraints from step 4

- **`db/queries/workspace.ts` is the private query surface** — the deliberate
  opposite of `public.ts`. It does NOT apply the `published` predicate (the
  researcher works on unpublished targets), and it MAY read `queue_items`. It
  does not, in this build, import findings, disclosure_events, leads, or
  outreach_events — those are step 5. Adding one is a step-5 change.
- **Auth is a single-user cookie gate, not an identity system.** One
  `WORKSPACE_PASSWORD`, no users table (10 tables stay locked). A login mints a
  signed, expiring cookie; `lib/auth.ts` verifies it. There is no DB session
  store. Both env secrets are required and server-only (never `NEXT_PUBLIC_`).
- **`lib/auth.ts` is runtime-agnostic on purpose** — Web Crypto (`crypto.subtle`)
  + `TextEncoder` only, so the SAME verifier runs in Edge middleware and the
  Node login action. Do not reach for Node's `crypto` module there; it breaks
  the Edge bundle. Env is read via static property access so Next can inline it.
- **`middleware.ts` is the gate.** It protects `/workspace` + `/workspace/:path*`
  and exempts only `/workspace/login` (the page and its server-action POST).
  robots.txt disallowing `/workspace` is defence in depth, not the control.
- **`priority_score` is computed, never stored** (`lib/priority.ts`, pure +
  tested like `drift.ts`). It is a private research heuristic with a written
  formula — NOT the public coverage metric, NOT a percentage. It never leaves
  the authed workspace and is never written to the DB.
- **The authed shell lives in the `(app)` route group.** `/workspace/login`
  sits outside it so it never inherits the nav/logout. `app/workspace/layout.tsx`
  only sets `noindex`. Every authed page is `force-dynamic` — private data is
  never prerendered or ISR-cached.
- **Step 4 is read-only** beyond auth. Queue transitions (queue/start/clear/
  drop) and the findings editor are step 5; target detail deliberately does not
  read the findings or disclosure_events tables.

## Locked constraints from step 5

- **Ingest lives in `lib/ingest.ts` and takes the `db` as an argument** — it
  imports no client (mirrors `db/seed.ts`), so the CLI (`scripts/ingest.ts`,
  `npm run db:ingest`) and the in-app `runIngestAction` share it. `recomputeDrift`
  calls the pure `computeDrift`; git ancestry stays out of the pure function
  (`resolveGitAncestry` shells `git merge-base --is-ancestor`). `recomputeDrift`
  trusts the `audit_deployments` link as recorded ancestry.
- **revalidation is the ingest/publish job.** The CLI cannot call
  `revalidatePath` (no request context); the in-app `runIngestAction` and
  `setPublished` do — that is why they exist. `setPublished` revalidates `/`,
  `/coverage`, `/protocols/[slug]`; ingest also uses `revalidatePath('/protocols/[slug]','page')`.
  This is the step-3 "unpublishing is delayed unless you revalidate" fix.
- **Auth cookie writes are route handlers, not server actions.** `cookies().set`
  inside a server action throws "cookies was called outside a request scope" in
  this Next build (verified). Login/logout are `app/workspace/auth/route.ts` and
  `.../logout/route.ts`, setting the cookie on the `NextResponse`. Middleware
  exempts BOTH `/workspace/login` and `/workspace/auth`. Do not "simplify" these
  back into server actions.
- **Token signing is split by runtime.** `lib/auth.ts` stays edge-safe (WebCrypto
  verify, for middleware); `lib/auth-node.ts` signs synchronously with
  `node:crypto` (for the Node route handler). Both are HMAC-SHA256 over the same
  message + secret, so an edge verify accepts a node-signed token. Never import
  `node:crypto` into `lib/auth.ts` — it breaks the edge middleware bundle.
- **Private mutations (`app/workspace/mutations.ts`) use `revalidatePath` +
  `redirect` only** — never `cookies()` — so they are safe as server actions.
  `db/queries/workspace.ts` now also reads findings + disclosure_events; it still
  never touches leads or outreach_events.
- **No `poc_code`, still.** The findings editor exposes `poc_ref` (a string
  pointer) and no code field. Do not add one.
- **`vitest.config.ts` aliases `@`** so tests can value-import `@/db/schema`
  (e.g. `lib/ingest.test.ts`). Keep it in sync with tsconfig `paths`.

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

## Locked constraints from step 6

- **DefiLlama is the CURATION layer, not the coverage engine.** The feed gives
  audit *presence* (`audits` count, `audit_links`) and money, never a reviewed
  commit, a report date, an auditor name, or a deployed contract address. Two
  different questions, never conflate them:
  · `auditStatus` (`audited`/`unaudited`) — "did anybody review this project" —
    computed at query time in `db/queries/workspace.ts`, answerable today.
  · `coverage_state` — "does the deployed code match what was audited" — needs
    both commits and stays `unknown` for sourced rows until step 7.
  A sourced protocol computing to `unknown` is the correct answer, not a bug.
- **The sync never fabricates deployments.** `deployments.address_or_program_id`
  is NOT NULL and DefiLlama has no per-contract addresses, so step 6 imports at
  the protocol + audits level only. Because `getQueue()` is keyed on
  deployments, those protocols are surfaced by a SECOND query,
  `getSourcedProtocols()`, and a second table on the queue page. Step 7 creates
  their deployments and they graduate into the real queue.
- **`syncFromDefiLlama` owns only what it sourced.** Its write payload is the
  enforcement point: it contains name, website, twitter, github_repo,
  defillama_id, tvl_usd and NOTHING else. `is_published`, `archived`,
  `security_contact` and every bounty field are absent, so a re-run can never
  republish a retracted protocol or clobber a researcher's note. `github_repo`
  is fill-if-empty (the feed only knows the ORG page). Never add a key to that
  payload without deciding what a re-run does to hand-entered data.
- **Narrowing the band does not retract what is already imported.** The dev
  branch was first synced at a $1M floor with no ceiling (1,274 protocols); the
  $50M ceiling landed after, so 359 above-band rows remain in `protocols`. That
  is the "never delete" rule working as designed, not a bug — they are
  unpublished and harmless, but they do sit at the top of the unpinned-protocol
  table by TVL. To retire them without deleting (both query surfaces already
  exclude archived rows):
  `update protocols set archived = true where tvl_usd > 50000000;`
  Decide this before step 7 pins contracts for a protocol you meant to drop.
- **Sourcing is idempotent and additive, unlike `db/seed.ts`.** Upsert on
  `protocols.slug`, chunked `insert … on conflict do update` (200 rows a
  statement — per-row updates time out at ~1,300 records). A protocol that
  leaves DefiLlama is NEVER deleted; you may have private findings against it.
- **Sourced rows land unpublished.** Nothing from the feed reaches the public
  index until the researcher flips the step-5 publish toggle.
- **Audit rows from the feed are coarse markers.** `source = 'defillama'`
  (its own enum member, not `protocol_docs`), `auditor = "Unknown (DefiLlama)"`,
  `report_date` and `reviewed_commit` NULL, and no `audit_deployments` link — so
  a marker can never move a deployment off `unknown`. Dedup is by report URL;
  when the feed claims N audits but publishes no links (real and common — see
  Aerodrome Slipstream) ONE count-marker row with a null `report_url` is written
  instead of N fabricated rows. `AUDIT_COUNT_MARKER_KEY` is that row's dedup key.
- **Two schema additions, still 10 tables.** `protocols.tvl_usd`
  (numeric(30,2) — the curated list's money column, distinct from the
  per-contract `deployments.tvl_usd`) and `'defillama'` on the `audit_source`
  enum. Migration `drizzle/0002_open_ironclad.sql`.
- **`computeProtocolPriority` is a SECOND private formula** in `lib/priority.ts`,
  for protocols with no deployments — none of `computePriority`'s inputs exist
  for them. Same rules as `priority_score`: pure, tested, written formula,
  computed at query time, never stored, never public, never a percentage.
- **Curation is a $1M–$50M TVL BAND, not just a floor.** Both edges are
  deliberate: below the floor a protocol is not worth a week; above the ceiling
  the list is CEXes and blue chips with standing audit relationships and their
  own security teams. Thresholds live in the environment, parsed by the pure
  `filterFromEnv` (`lib/sources/defillama.config.ts`): `DEFILLAMA_MIN_TVL_USD`
  (default $1M), `DEFILLAMA_MAX_TVL_USD` (default $50M, `0` = no ceiling),
  `DEFILLAMA_CATEGORIES`, `DEFILLAMA_CHAINS`,
  `DEFILLAMA_INCLUDE_INACTIVE`, `DEFILLAMA_MAX_PROTOCOLS`. All optional, all
  server-only — none may become `NEXT_PUBLIC_`; the curation policy is the shape
  of the private queue. Unparseable values fall back to the default rather than
  aborting a run. Rugged/deprecated/dead-link protocols are dropped by default.
- **The CLI is the primary run path.** `npm run db:source` does the full
  in-band sync (~900 protocols); the in-app "Sync DefiLlama" button is capped at
  `IN_APP_SYNC_LIMIT` (150 by TVL) because an 8MB fetch plus 1,300 upserts is
  not a serverless request's job. The button exists because only it can call
  `revalidatePath` — same split as `db:ingest` vs `runIngestAction` in step 5.
- **`lib/sources/defillama.ts` imports no DB and no schema.** Network and
  curation policy only; `lib/ingest.ts` is the write half and still takes `db`
  as an argument. Everything that turns a feed row into a curated record is a
  pure exported function tested against a fixture — the feed's field types are
  hostile (`audits` is a string, `github` is an org array, `url` is sometimes
  `ipfs://`) and every one of those shapes has a test.
