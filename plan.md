# Step 6 — DefiLlama integration (real data sourcing)

> **STATUS: BUILT.** This is the planning doc, kept for the reasoning. What
> shipped is recorded in CLAUDE.md under "Locked constraints from step 6";
> where the two disagree, CLAUDE.md is right. Answers to §9, as built:
> min TVL $1M · all categories · all chains · `protocols.tvl_usd` added ·
> `audit_source` extended with `'defillama'` · the queue surfaces protocols
> with no deployments (a second table, `getSourcedProtocols()`) · CLI is the
> primary run path with a capped in-app button · sourced rows stay unpublished.
> Dead protocols (rugged/deprecated/dead-link) are dropped by default — a
> judgment call beyond the answers, configurable via
> `DEFILLAMA_INCLUDE_INACTIVE`.
>
> Context: steps 1–5 built the schema, the public coverage index, and the
> private research/findings/disclosure workspace — but the app is seeded with 5
> hand-written protocols and has **no external data source**. The "ingest" in
> `lib/ingest.ts` only *recomputes* drift from rows already in the DB; it does
> not *acquire* anything. Step 6 makes the platform populate itself from
> DefiLlama so the workspace has a real, curated target list to hunt.

---

## 1. Goal & scope

**Goal:** auto-source a curated, detailed list of DeFi protocols from DefiLlama
— their TVL, chains, category, links, and **audit status (audited, with report
links / unaudited)** — into the existing `protocols` / `audits` tables, so the
private workspace queue is populated with real hunting targets instead of seed
data.

**In scope for step 6**

- A DefiLlama **source module** that fetches `/protocols` (+ `/protocol/{slug}`
  for detail) and upserts `protocols` and coarse `audits` rows.
- **Curation filters** (min TVL, categories, chains) so we import a focused set,
  not the ~5k-protocol firehose.
- **Idempotent sync** (upsert on a stable key), safe to re-run — not the
  wipe-and-replace that `db/seed.ts` does.
- A **protocol-level audit-presence signal** ("has audits" / "unaudited") so the
  curation is useful immediately, independent of commit-level drift (see §7).
- Wiring into the existing ingest flow: a CLI (`npm run db:source`) and an
  in-app action, both reusing `runIngest` for the recompute + revalidate.

**Explicitly NOT in scope (later steps)**

- **On-chain deployment & upgrade data** (real contract addresses per chain,
  `deployed_commit`, `last_upgraded_at`, upgrade events) — needs block explorers
  (Etherscan/Basescan/Arbiscan) and proxy-storage reads. That's **step 7**. It
  is what unlocks true commit-level `coverage_state`; DefiLlama cannot provide
  it. See §7.
- **Deep audit-report discovery** (GitHub `/audits` folders, auditor sites,
  reviewed commits, report dates) beyond the links DefiLlama already lists — a
  step-7 enrichment.
- **Submission generation** from a finding using `submission_template.md` — you
  are adding the template separately; wiring a "generate submission" action off
  a finding is its own step.

---

## 2. Key design decisions (need your call — recommendations given)

1. **DefiLlama gives protocol-level audit *presence*, not commit-level coverage.**
   Its `audits` (a count) and `audit_links` (report URLs) tell us *that* a
   protocol was audited and *where the report is* — but **not** the reviewed
   commit or report date, and it does **not** give per-contract deployed commits.
   The elaborate `coverage_state` machinery (`current`/`drifted`/`uncovered`)
   needs both commits, so **sourced protocols will mostly compute to `unknown`**
   until step 7 pins on-chain commits.
   - **Recommendation:** treat DefiLlama as the **curation layer** — "audited vs
     unaudited, here are the reports, here's the TVL and chains" — which is
     exactly the stated product purpose. Keep the commit-level drift engine as-is
     for the deeper analysis you do manually / in step 7. Add a **query-time
     `auditStatus`** (see §7), not a new stored column, to respect the locked
     10-table schema.

2. **How to represent a protocol's deployments before we have real addresses.**
   `deployments.address_or_program_id` is `NOT NULL`, so we can't create a
   deployment row without an address, and DefiLlama doesn't give per-contract
   addresses reliably (its `address` field is usually one token/gov address).
   - **Recommendation:** in step 6, **do not fabricate deployment rows.** Import
     at the **protocol + audits + metadata** level only. Deployments get created
     in step 7 from explorer data (or by hand). The queue view already keys on
     deployments, so decide (with the queue) whether step 6 should also surface
     *protocols with zero deployments yet* as candidates — probably yes, via a
     small query change, since an unaudited high-TVL protocol is a target even
     before we've pinned its contracts.

3. **Selection / curation criteria.** DefiLlama lists thousands of protocols.
   - **Recommendation:** import filtered by **min TVL** (e.g. ≥ $10M),
     optional **category** allow/deny (drop CEX, chain, bridge-aggregator noise
     if desired), and optional **chain** filter. Make thresholds config/env so
     you can widen later. Persist everything imported with
     `is_published = false` (schema default) so nothing hits the public index
     until you vet it.

4. **Publish gating.** Sourced rows must **not** auto-publish. Default
   `is_published=false` already handles this; the researcher flips visibility via
   the existing step-5 publish toggle after review. Confirm this is the intent
   (it matches the current security posture).

---

## 3. DefiLlama API reference

Free, no API key, no auth. Be a good citizen: cache, throttle, set a
`User-Agent`. **Verify field names against a live response before coding** — the
shapes below are from prior knowledge and may have drifted.

- `GET https://api.llama.fi/protocols`
  Array of all protocols. Useful fields (to confirm live):
  `name`, `slug`, `url`, `twitter`, `category`, `chains` (array), `chain` (main),
  `tvl` (number), `chainTvls`/`currentChainTvls` (per-chain), `logo`,
  `gecko_id`, `cmcId`, `audits` (string count, e.g. `"2"`), `audit_links`
  (array of report URLs), `audit_note`, `oracles`, `forkedFrom`, `listedAt`,
  `address` (often `"chain:0x…"`, usually a token/gov address — **not** the set
  of deployed contracts).

- `GET https://api.llama.fi/protocol/{slug}`
  Per-protocol detail: description, richer `currentChainTvls`, sometimes
  `address`, historical TVL. Use sparingly (one call per imported protocol) for
  fields the list endpoint lacks.

Notes:
- `audit_links` is the gold — those are the **audit report URLs** the product
  promises. `audits === "0"` / empty `audit_links` ⇒ **unaudited** (a prime
  target).
- Rate limits are informal; add a small delay between `/protocol/{slug}` calls
  and cache the `/protocols` payload for a run.

---

## 4. Data mapping (DefiLlama → schema)

| DefiLlama field | → column (`protocols`) | notes |
| --- | --- | --- |
| `slug` | `slug` (unique) | primary match key for upsert |
| `slug` | `defillama_id` | already a column; store the slug/id |
| `name` | `name` | |
| `url` | `website` | |
| `twitter` | `twitter` | |
| `gecko_id` | — | optional; no column today |
| `audit_links` / `audits` | → `audits` rows | see below |
| — | `is_published` | force `false` on import |
| — | `has_bounty` / `bounty_*` | **DefiLlama has no bounty data**; leave defaults, enrich later (Immunefi API is a separate source) |

`audits` rows created from DefiLlama are **coarse markers**:

| source value | column (`audits`) |
| --- | --- |
| each URL in `audit_links` | one `audits` row, `report_url = link` |
| — | `auditor` = `"Unknown (DefiLlama)"` (no auditor name in the feed) |
| — | `report_date = NULL`, `reviewed_commit = NULL` (unknown → keeps `computeDrift` honest) |
| — | `source = 'protocol_docs'` (closest enum member) or extend `audit_source` enum with `'defillama'` (small additive migration) |
| — | `verified_by_me = false` |

`tvl` / `chainTvls`: no protocol-level TVL column exists (TVL lives on
`deployments`). Since step 6 doesn't create deployments, **decide** whether to
(a) add a nullable `protocols.tvl_usd` for the curated list's sort key
(small additive migration), or (b) keep TVL only for later deployment rows.
**Recommendation:** add `protocols.tvl_usd` — the curated list needs a money
column to rank by, and it's the natural home before deployments exist.

---

## 5. Architecture & new files (respect the locked constraints)

Follow the established patterns:

- **`lib/sources/defillama.ts`** — pure-ish fetch + normalize. Exports typed
  `fetchProtocols(filter)` returning normalized records; no DB import. Network
  lives here (unlike `lib/drift.ts`, which stays pure).
- **`lib/ingest.ts`** — add `syncFromDefiLlama(db, records)` that upserts
  protocols + audit markers. Keep the `db`-as-argument rule (no `db/client`
  import) so the CLI and the app both drive it. `runIngest` can gain an optional
  source step, or stay recompute-only with sourcing as a separate call.
- **`scripts/source-defillama.ts`** + **`npm run db:source`** — CLI runner,
  builds its own Neon HTTP connection like `db/seed.ts` and `scripts/ingest.ts`.
- **In-app action** in `app/workspace/mutations.ts` — a "Sync from DefiLlama"
  button on the queue, gated by the existing auth, that runs the sync then
  `runIngestAction`'s recompute + `revalidatePath`. (Long fetches on a serverless
  request may hit timeouts — consider the CLI/cron as the primary path and the
  button for small refreshes, or chunk it.)
- **Config:** thresholds (min TVL, categories, chains) in env or a small
  `lib/sources/defillama.config.ts`.

Constraints to honor (from CLAUDE.md):
- `db/queries/public.ts` stays the public security boundary — no new imports.
- Source/ingest modules take `db` as an argument; never import the server-only
  client into a `tsx` script.
- Schema is "locked at 10 tables" — the additive columns proposed here
  (`protocols.tvl_usd`, optional `audit_source` enum value) are **column/enum**
  additions, not new tables, but still need `npm run db:generate` + a committed
  migration and a note in CLAUDE.md. Get sign-off before adding them.

---

## 6. Sync semantics

- **Idempotent upsert** on `protocols.slug` (unique). Insert new, update changed,
  never wipe. Re-runnable safely (unlike `seed`).
- **Audit rows:** avoid duplicating on re-run — match on
  `(protocol_id, report_url)` before inserting; skip existing links.
- **Deletions/delistings:** if a protocol leaves DefiLlama, do **not** delete
  (you may have private findings against it). Mark stale via `archived` or a
  `last_seen` concept — decide later; safe default is leave untouched.
- **Every import `is_published=false`.** Publishing stays a manual, per-protocol
  decision through the step-5 toggle.

---

## 7. Coverage-state reconciliation (the important nuance)

Two different questions, don't conflate them:

- **"Is this protocol audited at all, and where are the reports?"** — answerable
  from DefiLlama *now*. This is the curation the product is fundamentally about.
- **"Does the *currently deployed code* match what was audited?"** — the
  `coverage_state` engine. Needs `deployed_commit` (explorer/step 7) **and**
  `reviewed_commit` (deep report parsing/step 7). DefiLlama gives neither.

**Recommendation:** introduce a **query-time `auditStatus`** for the curated
protocol list — `audited` (has ≥1 audit row) vs `unaudited` (none) — computed in
`db/queries/workspace.ts` (and, if you want it public, a carefully-scoped
addition to `public.ts`). This gives the "recent audits / no audit at all"
filtering immediately, without touching the locked schema and without pretending
we know commit-level drift we don't. `coverage_state` stays the deeper signal
that lights up once step 7 pins commits.

---

## 8. Testing

- Unit-test the **DefiLlama normalizer** against a saved sample `/protocols`
  JSON fixture (audited, unaudited, multi-chain, missing-field cases) — pure,
  no network, fits the existing `lib/**/*.test.ts` + vitest setup.
- Unit-test the **upsert/dedup decision** logic (pure helper, like
  `needsCandidate`).
- Manual: run `npm run db:source` against a scratch Neon branch, confirm counts,
  re-run to prove idempotency, then `npm run db:ingest` and eyeball the queue.

---

## 9. Open questions for you

1. **Curation thresholds** — min TVL? category allow/deny list? which chains?
2. **Add `protocols.tvl_usd`** (recommended) so the curated list has a money
   sort key before deployments exist — yes/no?
3. **Extend `audit_source` enum with `'defillama'`** vs. reuse `'protocol_docs'`?
4. Should the queue surface **protocols with no deployments yet** as targets
   (needs a small `getQueue` change), or only deployment-level rows?
5. Primary run path: **CLI/cron** (`db:source`), **in-app button**, or both?
6. Confirm sourced rows stay **unpublished** until manually vetted (recommended). 

---

## 10. Suggested build order for step 6

1. `lib/sources/defillama.ts` + fixture + normalizer tests (no DB).
2. Any agreed schema additions (`tvl_usd`, enum) → `db:generate` → migration.
3. `syncFromDefiLlama(db, …)` in `lib/ingest.ts` + dedup tests.
4. `scripts/source-defillama.ts` + `npm run db:source`; run against a scratch
   branch, verify idempotency.
5. `auditStatus` query-time derivation + surface it in the workspace queue
   (filter/sort by audited vs unaudited).
6. Optional in-app "Sync from DefiLlama" action + revalidate.
7. Update CLAUDE.md (new source module, any schema change, run commands) and
   README; mark step 6 done.
