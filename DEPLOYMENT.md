# Deployment

Audit Coverage Index is a Next.js 15 (App Router) app backed by Postgres on
Neon. It is designed for **Vercel** — it uses ISR, the Edge runtime for
middleware and OG images, and the Neon serverless HTTP driver, all of which
Vercel supports natively. Self-hosting on Node also works; see §11.

**Minimum to get live:** three environment variables and one migration run.
**To get the full pipeline:** two more (an Etherscan key and a GitHub token),
plus the operating loop in §9.

Build steps 1–7 are complete. This document covers deploying and then *running*
what they built.

---

## 1. What you are deploying

Two surfaces from one codebase, separated by a security boundary that is
enforced in code, not by convention:

| Surface | Routes | Auth | Caching | Reads through |
| --- | --- | --- | --- | --- |
| **Public coverage index** | `/`, `/index`, `/protocols/[slug]`, `/robots.txt`, `/sitemap.xml`, OG images | none, indexed | ISR, `revalidate = 3600` | `db/queries/public.ts` — 5 tables only |
| **Private research workspace** | `/workspace/*` | single-user cookie gate | `force-dynamic`, never cached | `db/queries/workspace.ts` |

The public surface can never reach `findings`, `disclosure_events`, `leads` or
`outreach_events`. That is a property of `db/queries/public.ts` importing exactly
five tables, and adding an import there is a security change rather than a
refactor.

---

## 2. Prerequisites

- A [Neon](https://neon.tech) account (free tier is fine) for Postgres.
- A [Vercel](https://vercel.com) account, connected to the GitHub repo.
- Node 20+ and `npm` locally — for migrations and for the data pipeline, which
  is CLI-first by design (§9).
- An [Etherscan API key](https://etherscan.io/apis) (free) if you want on-chain
  resolution. One key covers every supported chain.
- Optionally a GitHub read-only token for audit discovery at 5,000 calls/hour
  instead of 60.

---

## 3. Provision the database (Neon)

1. Create a Neon project. Neon gives every project a **production** branch and
   lets you create more (e.g. a `dev` branch for local work). Use a dev branch
   locally — the sourcing and resolution commands write real rows.
2. Copy the **pooled** connection string from the Neon dashboard
   (`...-pooler.<region>.aws.neon.tech`). The app talks to Postgres over HTTP
   via `@neondatabase/serverless`, and a pooled URL is correct for that driver:

   ```
   postgresql://USER:PASSWORD@ep-xxxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

Keep this string secret — it is `DATABASE_URL` below.

---

## 4. Environment variables

Set these in **Vercel → Project → Settings → Environment Variables** (Production,
and Preview if you want protected preview deploys). Everything except
`NEXT_PUBLIC_SITE_URL` is server-side and must stay that way.

### Required

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** connection string (§3). |
| `WORKSPACE_PASSWORD` | The single login password for `/workspace`. Choose a strong one. |
| `WORKSPACE_SESSION_SECRET` | HMAC key the session cookie is signed with. `openssl rand -base64 32`. Rotating it signs you out. |

> Both `WORKSPACE_*` values are read at runtime, including by the Edge
> middleware. If either is missing, every `/workspace` request fails closed.

### Optional — public origin

| Variable | What it is |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Public origin for canonical URLs, `robots.txt`, the sitemap and OG image URLs. **Leave unset until you have a custom domain** — it falls back to Vercel's production hostname automatically (§7). |

### Optional — the data pipeline (steps 6 and 7)

| Variable | Default | What it is |
| --- | --- | --- |
| `ETHERSCAN_API_KEY` | — | Etherscan **V2** key. One key, every supported chain. Required for `db:onchain` and the "Resolve on-chain" buttons. |
| `EXPLORER_THROTTLE_MS` | `250` | Milliseconds between explorer calls. |
| `EXPLORER_MAX_UPGRADES` | `200` | `upgrade_events` written per deployment. |
| `GITHUB_TOKEN` | — | Read-only, public-repo scope. Lifts discovery from 60 to 5,000 calls/hour. |
| `GITHUB_MAX_REPORTS` | `40` | Reports imported per repo. |
| `GITHUB_RESOLVE_COMMITS` | `true` | `false` skips the per-report commit lookup. |
| `DEFILLAMA_MIN_TVL_USD` | `1000000` | Curation floor. |
| `DEFILLAMA_MAX_TVL_USD` | `50000000` | Curation ceiling; `0` = none. |
| `DEFILLAMA_CATEGORIES` | all | Comma-separated allowlist. |
| `DEFILLAMA_CHAINS` | all | Comma-separated allowlist. |
| `DEFILLAMA_INCLUDE_INACTIVE` | `false` | Keep rugged/deprecated/dead rows. |
| `DEFILLAMA_MAX_PROTOCOLS` | `0` | `0` = no cap. |

Every optional value falls back to its default rather than aborting a run if it
is unparseable. **None of these may become `NEXT_PUBLIC_`**: the curation policy
is the shape of the private queue, and the two keys are credentials.

Locally the same variables live in `.env.local` (gitignored). Copy
`.env.local.example` and fill it in.

---

## 5. Deploy on Vercel

1. **Import the repo**: Vercel → *Add New… → Project* → pick
   `Hybridthegamer/audit-coverage-index`.
2. Framework preset auto-detects **Next.js**. Leave build/output settings at
   their defaults (`next build`). Do **not** add a custom build command yet.
3. Add the environment variables from §4.
4. Deploy. The first build prerenders the public pages and 404s the
   `/workspace/*` routes for anyone without a session — expected.

At this point the site is live on `https://<project>.vercel.app`, but the
database is empty, so the index shows "No published deployments yet." Fix that
in §6 and §9.

---

## 6. Apply migrations

Migrations under `drizzle/` are the source of truth for the schema. Vercel does
**not** run them during build, so apply them once against the production Neon
branch, from your machine:

```bash
# With the PRODUCTION DATABASE_URL in .env.local:
npm ci
npm run db:migrate      # 10 tables, all enums, the audit_deployments join,
                        # and the step-7 unique index on deployments
```

There are four committed migrations (`0000`–`0003`). `0003` is step 7's only
schema change: a unique index on `(protocol_id, chain, lower(address))` so a
contract cannot be pinned twice. Step 7 added **no new tables and no new
columns** — the count stays at 10.

Optionally load the illustrative sample data (5 protocols across every coverage
state). **Seeding wipes and replaces all rows** — only on a fresh database:

```bash
npm run db:seed
```

For real data, skip the seed and go to §9.

> Prefer to keep the prod `DATABASE_URL` out of `.env.local`? Run commands with
> it inline: `DATABASE_URL="postgres://…prod…" npm run db:migrate`.

**Alternative — migrate during build.** Set the Vercel build command to
`npm run db:migrate && next build`. Keeps schema in lockstep with deploys, runs
on every build; fine for a single maintainer, riskier with concurrent deploys.
Manual is the default recommendation.

---

## 7. Custom domain (optional, finishes step 3)

Until a custom domain exists, `NEXT_PUBLIC_SITE_URL` is unset and the app falls
back to `VERCEL_PROJECT_PRODUCTION_URL` (Vercel injects it), so canonical tags,
the sitemap and OG images resolve to your `*.vercel.app` origin.

When you add a domain:

1. Vercel → *Settings → Domains* → add the domain and follow the DNS steps.
2. Set `NEXT_PUBLIC_SITE_URL` to the full origin, e.g.
   `https://auditcoverage.xyz` (no trailing slash).
3. Redeploy so the value is baked into the client bundle and metadata.

No code change is needed — the origin lives only in `lib/site.ts`.

---

## 8. Post-deploy smoke check

- `GET /` → landing page with the coverage summary.
- `GET /index` → the coverage table (served by a rewrite from `/coverage`).
- `GET /protocols/<slug>` → a published protocol; an unpublished slug 404s.
- `GET /robots.txt` and `/sitemap.xml` → present; robots disallows `/workspace`
  and `/coverage`.
- `GET /workspace` → **redirects to `/workspace/login`** (the gate works).
- Log in with `WORKSPACE_PASSWORD` → the queue loads.
- Open a target → toggle **Publish/Unpublish** → the public page appears/404s
  within moments (the toggle calls `revalidatePath`).

---

## 9. Operating the pipeline

This is the part that matters after the first deploy. Four commands, each
idempotent, each safe to re-run, and each with a capped in-app equivalent.

### The shape of it

```
  db:source   DefiLlama  →  protocols + coarse audit markers   (curation)
  db:audits   GitHub     →  audits with real auditor + date    (the audit side)
  db:onchain  Etherscan  →  deployments, upgrades, proxy facts (the chain side)
      ↓
  you pin the two commits by hand in /workspace
      ↓
  db:ingest   → computeDrift → coverage_state + drift_days     (the verdict)
```

### CLI first, buttons second — and why

Every one of these has a button in `/workspace` and a CLI command, and the CLI
is the primary path in each case. The split is deliberate and identical
throughout:

- The **CLI** can take minutes and make thousands of calls. It cannot call
  `revalidatePath()` — there is no Next request context outside a request — so
  public ISR pages catch up at their next hourly revalidation or on redeploy.
- The **in-app button** is capped so it fits a serverless request's budget, and
  it exists *because* only it can invalidate the ISR cache immediately.

| Job | CLI (primary) | In-app button | Cap |
| --- | --- | --- | --- |
| Curate protocols | `npm run db:source` | Sync DefiLlama | 150 by TVL |
| Discover audit reports | `npm run db:audits` | Discover audits | 25 protocols |
| Resolve on-chain | `npm run db:onchain` | Resolve on-chain | 12 deployments |
| Recompute coverage | `npm run db:ingest` | Run ingest | — |

### 9.1 Curate the target list — `npm run db:source`

Pulls `https://api.llama.fi/protocols` (free, no key), filters to the
$1M–$50M TVL band, and upserts. At the default band that is ~900 protocols out
of ~8,100.

```bash
npm run db:source -- --dry-run     # fetch and report, write nothing
npm run db:source -- --limit=50    # cap to the 50 biggest by TVL
npm run db:source                  # the full in-band sync
```

Idempotent and **additive** — the opposite of `db:seed`. It upserts on
`protocols.slug`, never deletes, and writes only the columns it sourced, so a
re-run cannot republish, unpublish, or overwrite a security contact, a bounty,
or a hand-recorded GitHub repo. **Everything it imports stays unpublished.**

Sourced protocols have no contract addresses (DefiLlama has none), so they land
in the queue page's second table, "Sourced, not yet pinned".

### 9.2 Discover audit reports — `npm run db:audits`

Walks each protocol's GitHub for an `audits/` folder (or a repo *named* `audits`
— several protocols do that) and records what it finds: a real auditor name and,
where the filename states one, a real report date.

```bash
npm run db:audits -- --limit=25              # ranked by TVL
npm run db:audits -- --protocol=412          # one protocol
npm run db:audits -- --refresh               # re-visit ones already discovered
npm run db:audits -- --no-commits            # skip the commit lookup (cheaper)
```

Without `GITHUB_TOKEN` you get 60 calls/hour, which is enough interactively but
not for a sweep. **It does not write `reviewed_commit`** — see §10.

### 9.3 Pin contracts, then resolve them — `npm run db:onchain`

A protocol becomes a real target the moment one contract is pinned to it. Open
it from the queue's second table (`/workspace/protocols/<id>`), paste an address
and a chain, and it graduates into the ranked queue.

Then resolve it:

```bash
npm run db:onchain -- --limit=25       # the backlog of never-resolved pins
npm run db:onchain -- --protocol=412   # one protocol's contracts
npm run db:onchain -- --refresh        # re-resolve already-resolved pins
```

Resolution records the creation date (`deployed_at`), whether the contract sits
behind a proxy and which kind, the current implementation, the EIP-1967 admin
(`upgrade_authority`), whether source is verified, and **every
`Upgraded(address)` log** as an `upgrade_events` row — the newest of which
becomes `last_upgraded_at`.

**Supported chains:** Ethereum, Optimism, BNB Chain, Polygon, Base, Arbitrum.
Etherscan V2 is one API keyed by `chainid`, which is why there is one key rather
than three. Solana, Stacks, Aptos, Sui, the Cosmos chains, Starknet and TON have
no equivalent; those pins are reported as skipped and recorded by hand.

### 9.4 Recompute — `npm run db:ingest`

```bash
npm run db:ingest
```

Recomputes `coverage_state` and `drift_days` for every deployment via the pure
`computeDrift()`, and tops up the candidate research queue. The step-7 actions
that can change a verdict already run this for you; the CLI is for a scheduled
job.

### 9.5 A scheduled run

A daily cron doing the whole loop, against the production `DATABASE_URL`:

```bash
npm run db:source && npm run db:audits -- --limit=100 \
  && npm run db:onchain -- --limit=100 && npm run db:ingest
```

None of it can revalidate the ISR cache, so public pages catch up within the
hour. Trigger the in-app **Run ingest** when you need a public change to land
immediately.

---

## 10. The two commits you pin by hand

This is the most important operational fact about the system, so it gets its own
section.

`computeDrift()` needs two commits to produce anything other than `unknown`:

- `deployments.deployed_commit` — what is running on-chain
- `audits.reviewed_commit` — what the auditor looked at

**No external source can supply either.** A block explorer has bytecode and, at
best, verified source text — never the commit that produced it. A report
filename is not a review scope, and the commit that *added* a report to a repo
is typically days or weeks after the review it describes.

So step 7 deliberately splits into what it writes and what it refuses to:

| Written automatically (facts) | Never written (assertions) |
| --- | --- |
| addresses, `deployed_at`, `last_upgraded_at` | `deployed_commit` |
| `is_upgradeable`, `upgrade_authority`, `source_verified` | `reviewed_commit` |
| `upgrade_events`, `explorer_url` | `audit_deployments` links |
| audit `auditor`, `report_url`, stated `report_date` | |

The refused three are exactly what `unknown` is waiting on. The workspace gives
you one control for each:

1. **Target page → "Record deployed commit"** — your assertion, matched from the
   verified source. Submitting it empty retracts the claim and returns the
   target to `unknown`.
2. **Target page → each audit → "Record reviewed commit"** — also flips
   `verified_by_me`, because filling it in *is* the verification. Discovery
   leaves a **candidate** sha in that audit's scope note; this is where it stops
   being a note.
3. **Target page → each audit → "This audit covers this deployment"** — creates
   the `audit_deployments` link, which `recomputeDrift` trusts as recorded
   ancestry. This single row is what the whole public verdict rests on, which is
   why nothing automated ever creates one.

Each of those three recomputes drift and revalidates the public pages
immediately.

A sourced protocol sitting at `unknown` is the system being honest, not broken.

---

## 11. Generating a submission

Once a finding is recorded, `/workspace/findings/<id>/submission` renders the
three artefacts of `vulnerability-submission-template.md` from what the finding
actually holds: the initial contact (plain text, no technical detail), the full
report, and the fix-verification note. Each has a button that logs the matching
disclosure event, so the timeline reflects what you sent.

Three guarantees, enforced in `lib/submission.ts` rather than left to the
template:

- **No PoC code, ever.** `findings.poc_ref` is a string pointer and the schema
  has no `poc_code` column. The report renders the pointer and tells you to
  attach the runnable test out-of-band.
- **Missing data is loud.** Every unfilled field becomes a `[TODO: …]` marker
  and is listed in a banner at the top of the page. A half-filled report sent
  confidently is the fastest way to lose a triager.
- **Nothing is inflated.** Severity, funds at risk and the coverage claim render
  exactly as recorded. The post-audit callout — the project's whole thesis —
  appears only when the finding is actually flagged `in_post_audit_code`.

---

## 12. Self-hosting on Node (alternative)

Vercel isn't required — the app runs on any Node 20+ host:

```bash
npm ci
npm run build
npm run start        # serves on $PORT (default 3000)
```

Provide the same environment variables in the process environment. Put the app
behind TLS: the session cookie is set `Secure` in production, so `/workspace`
login only works over HTTPS. Middleware and OG images run on Node's runtime here
rather than the Edge; both are supported.

---

## 13. Troubleshooting

**Auth and access**

- **`/workspace` returns 500, or login never sets a session** — a `WORKSPACE_*`
  variable is missing or the deploy predates setting it. Set both, redeploy.
- **Login works but you bounce back to `/workspace/login`** — the cookie was set
  but rejected: usually the site isn't on HTTPS (the cookie is `Secure` in
  production), or `WORKSPACE_SESSION_SECRET` differs between the instance that
  signed it and the one verifying it. Keep the secret stable.

**Public pages**

- **The index is empty after deploy** — migrations haven't run against the
  production database (§6), or nothing is published (`is_published`). Everything
  the sync imports is unpublished by design.
- **Unpublishing doesn't take effect immediately** — public pages are ISR-cached
  at one hour. Use the in-app publish toggle (it revalidates) rather than a raw
  DB edit.
- **OG images 500 or render blank** — they run on the Edge runtime and fetch
  fonts as TTF from Google Fonts; a network block on the font host is the usual
  cause. The renderer falls back to a bundled face, so this degrades rather than
  breaks.
- **Canonical/OG URLs point at localhost or the wrong host** —
  `NEXT_PUBLIC_SITE_URL` is unset or wrong (§7).

**The pipeline**

- **"ETHERSCAN_API_KEY is not set"** — expected until you add one. Pinning
  contracts by hand still works; nothing resolves automatically.
- **`db:onchain` reports failures with "Max rate limit reached"** — raise
  `EXPLORER_THROTTLE_MS`. One address costs seven calls and the free tier allows
  five a second. Failures are per-address and never abort the run, so just
  re-run: already-resolved pins are skipped without `--refresh`.
- **`db:audits` stops early with "rate limit exhausted"** — set `GITHUB_TOKEN`.
  Unauthenticated GitHub allows 60 calls an hour.
- **Discovery finds nothing for most protocols** — expected. "No audits folder
  found" is the majority outcome; many protocols publish reports on their docs
  site rather than in the repo, and step 6's DefiLlama markers already cover
  those links.
- **An audit shows `auditor: "Unknown (GitHub)"`** — the filename named no firm
  the parser recognises. That is the designed degradation: an unrecognised name
  becomes "Unknown" rather than a wrong attribution. Add the firm to
  `KNOWN_AUDITORS` in `lib/sources/github.ts` and re-run with `--refresh`.
- **Everything is `unknown`** — read §10. That is the system waiting for the two
  commits, and it is correct until you pin them.
- **A protocol you narrowed out of the band is still in the workspace** — the
  sync never deletes, so tightening a threshold leaves old rows behind. Retire
  them by archiving, never deleting (a delete takes any private findings with
  it): `update protocols set archived = true where tvl_usd > 50000000;`. Both
  query surfaces exclude archived rows, and a re-run of `db:source` will not
  resurrect one.
