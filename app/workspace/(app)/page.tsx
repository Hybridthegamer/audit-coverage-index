import Link from "next/link";

import { Reveal } from "@/components/Reveal";
import { StateMarker } from "@/components/StateMarker";
import { WorkspaceNav } from "@/components/WorkspaceNav";
import {
  discoverAuditsSweepAction,
  runIngestAction,
  syncDefiLlamaAction,
} from "@/app/workspace/mutations";
import {
  getProtocolList,
  getQueue,
  summarizeQueue,
  type ProtocolSort,
} from "@/db/queries/workspace";
import {
  auditStatusLabel,
  chainLabel,
  formatDrift,
  formatTvl,
  plural,
  queueStatusLabel,
  truncateAddress,
} from "@/lib/format";
import { IN_APP_SYNC_LIMIT } from "@/lib/sources/defillama.config";
import { IN_APP_DISCOVER_LIMIT } from "@/lib/sources/github.config";

/**
 * THE TARGET LIST — the workspace's front door.
 *
 * What this page is for: pick a protocol to audit. That decision needs money,
 * audit presence, category and chain, and this renders exactly those, over every
 * protocol the DefiLlama sync curated, filterable, on the first sync.
 *
 * It deliberately does NOT require a pinned contract, a deployed commit, an
 * audit link or a publish. Those belong to coverage_state — the harder question
 * of whether deployed code matches what was reviewed — which lives on the target
 * pages and is opt-in per protocol. Earlier this page led with that machinery
 * and buried the list underneath it, which made an empty deployment queue look
 * like an empty product. The list leads now; coverage is the section below it,
 * and it only appears once something is actually pinned.
 *
 * Filters are URL search params, not client state: the page stays a server
 * component, every view is linkable, and the back button works.
 *
 * force-dynamic: private data behind auth. Never prerendered, never ISR-cached.
 */
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

const SORTS: { value: ProtocolSort; label: string }[] = [
  { value: "priority", label: "Priority" },
  { value: "tvl", label: "TVL" },
  { value: "reports", label: "Reports" },
  { value: "name", label: "Name" },
];

type SearchParams = Record<string, string | string[] | undefined>;

function one(params: SearchParams, key: string): string | null {
  const v = params[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s !== undefined && s.trim().length > 0 ? s.trim() : null;
}

/** Build a querystring with one key overridden — used by every control. */
function withParam(
  params: SearchParams,
  key: string,
  value: string | null,
): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s !== undefined && s.length > 0 && k !== key && k !== "page") next.set(k, s);
  }
  if (value !== null && value.length > 0) next.set(key, value);
  const qs = next.toString();
  return qs.length > 0 ? `/workspace?${qs}` : "/workspace";
}

/** A row of link-styled filter chips. Radix-free, border-radius 0 (bam83). */
function Chips({
  label,
  options,
  active,
  params,
  paramKey,
}: {
  label: string;
  options: { value: string | null; label: string }[];
  active: string | null;
  params: SearchParams;
  paramKey: string;
}) {
  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
      <span className="bam-data-key" style={{ minWidth: "5.5rem" }}>
        {label}
      </span>
      {options.map((o) => {
        const isActive = (o.value ?? null) === active;
        return (
          <Link
            key={o.label}
            href={withParam(params, paramKey, o.value)}
            className="bam-btn-sm"
            style={{
              textDecoration: "none",
              borderColor: isActive ? "var(--bam-cream)" : "var(--bam-cream-20)",
              color: isActive ? "var(--bam-cream)" : "var(--bam-cream-60)",
            }}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const auditStatus = one(params, "audit");
  const category = one(params, "category");
  const chain = one(params, "chain");
  const search = one(params, "q");
  const minTvlRaw = one(params, "minTvl");
  const sortRaw = one(params, "sort");
  const pageRaw = one(params, "page");

  const sort = (SORTS.find((s) => s.value === sortRaw)?.value ?? "priority") as ProtocolSort;
  const page = Math.max(1, Number(pageRaw) || 1);
  const minTvlUsd = minTvlRaw !== null ? Number(minTvlRaw) : null;

  const [list, queue] = await Promise.all([
    getProtocolList({
      auditStatus: auditStatus === "audited" || auditStatus === "unaudited" ? auditStatus : null,
      category,
      chain,
      search,
      minTvlUsd: Number.isFinite(minTvlUsd) ? minTvlUsd : null,
      sort,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    getQueue(),
  ]);

  const counts = summarizeQueue(queue);
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const filtered = list.total !== list.grandTotal;

  return (
    <>
      <WorkspaceNav page="TARGETS" />

      <main className="bam-page" data-surface="dense">
        {/* ─── Header + sync ─────────────────────────────────────────── */}
        <section
          className="bam-pad-x"
          style={{ paddingTop: "var(--bam-space-2xl)", paddingBottom: "var(--bam-space-lg)" }}
        >
          <Reveal>
            <p className="bam-eyebrow">
              {plural(list.grandTotal, "PROTOCOL")} · {list.unaudited} UNAUDITED IN VIEW
              {counts.total > 0 ? ` · ${plural(counts.total, "PINNED CONTRACT")}` : ""}
            </p>
            <h1 className="bam-headline">Targets.</h1>
            <p className="bam-body" style={{ maxWidth: "60ch", marginTop: "var(--bam-space-lg)" }}>
              Every curated protocol, ranked by how much it is worth a look — audit
              presence first, then money at risk. Filter, pick one, audit it however
              you like. Nothing here needs setting up: the list is complete from the
              moment a sync finishes.
            </p>

            <div
              style={{
                display: "flex",
                gap: "var(--bam-space-sm)",
                flexWrap: "wrap",
                marginTop: "var(--bam-space-lg)",
              }}
            >
              <form action={syncDefiLlamaAction}>
                <button type="submit" className="bam-btn-primary">
                  Sync · top {IN_APP_SYNC_LIMIT}
                </button>
              </form>
              <form action={discoverAuditsSweepAction}>
                <button type="submit" className="bam-btn-sm">
                  Find audit reports · {IN_APP_DISCOVER_LIMIT}
                </button>
              </form>
              <form action={runIngestAction}>
                <button type="submit" className="bam-btn-sm">
                  Recompute coverage
                </button>
              </form>
            </div>
            <p
              className="bam-eyebrow"
              style={{ marginTop: "var(--bam-space-sm)", color: "var(--bam-cream-40)" }}
            >
              FULL SYNC IS <code>npm run db:source</code> — THE BUTTON IS CAPPED FOR THE REQUEST BUDGET
            </p>
          </Reveal>
        </section>

        {/* ─── Filters ───────────────────────────────────────────────── */}
        <section className="bam-pad-x" style={{ paddingBottom: "var(--bam-space-lg)" }}>
          <Reveal>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--bam-space-sm)" }}>
              <Chips
                label="AUDIT"
                paramKey="audit"
                active={auditStatus}
                params={params}
                options={[
                  { value: null, label: "All" },
                  { value: "unaudited", label: "No audit" },
                  { value: "audited", label: "Audited" },
                ]}
              />
              <Chips
                label="MIN TVL"
                paramKey="minTvl"
                active={minTvlRaw}
                params={params}
                options={[
                  { value: null, label: "Any" },
                  { value: "5000000", label: "$5M+" },
                  { value: "10000000", label: "$10M+" },
                  { value: "25000000", label: "$25M+" },
                ]}
              />
              <Chips
                label="SORT"
                paramKey="sort"
                active={sortRaw ?? "priority"}
                params={params}
                options={SORTS.map((s) => ({ value: s.value, label: s.label }))}
              />

              {/* Category and chain have 58 and 271 values, so they are selects
                  rather than chips. GET forms keep this a server component. */}
              <form
                method="get"
                action="/workspace"
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                  alignItems: "flex-end",
                  marginTop: "var(--bam-space-sm)",
                }}
              >
                {auditStatus ? <input type="hidden" name="audit" value={auditStatus} /> : null}
                {minTvlRaw ? <input type="hidden" name="minTvl" value={minTvlRaw} /> : null}
                {sortRaw ? <input type="hidden" name="sort" value={sortRaw} /> : null}

                <div className="bam-field" style={{ margin: 0, minWidth: "12rem" }}>
                  <label className="bam-label" htmlFor="category">
                    Category
                  </label>
                  <select id="category" name="category" className="bam-input" defaultValue={category ?? ""}>
                    <option value="">All categories</option>
                    {list.categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="bam-field" style={{ margin: 0, minWidth: "12rem" }}>
                  <label className="bam-label" htmlFor="chain">
                    Chain
                  </label>
                  <select id="chain" name="chain" className="bam-input" defaultValue={chain ?? ""}>
                    <option value="">All chains</option>
                    {list.chains.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="bam-field" style={{ margin: 0, minWidth: "12rem" }}>
                  <label className="bam-label" htmlFor="q">
                    Search
                  </label>
                  <input
                    id="q"
                    name="q"
                    className="bam-input"
                    defaultValue={search ?? ""}
                    placeholder="name or slug"
                  />
                </div>

                <button type="submit" className="bam-btn-sm">
                  Apply
                </button>
                {filtered || search !== null ? (
                  <Link href="/workspace" className="bam-btn-sm" style={{ textDecoration: "none" }}>
                    Reset
                  </Link>
                ) : null}
              </form>
            </div>
          </Reveal>
        </section>

        {/* ─── The list ──────────────────────────────────────────────── */}
        <section className="bam-pad-x" style={{ paddingBottom: "var(--bam-space-3xl)" }}>
          <Reveal>
            <div className="bam-table-scroll">
              <table className="bam-table">
                <caption
                  className="bam-eyebrow"
                  style={{ textAlign: "left", marginBottom: "var(--bam-space-sm)" }}
                >
                  {filtered
                    ? `${plural(list.total, "MATCH")} OF ${list.grandTotal}`
                    : `${plural(list.grandTotal, "PROTOCOL")}`}
                  {pages > 1 ? ` · PAGE ${page} OF ${pages}` : ""}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Priority
                    </th>
                    <th scope="col">Protocol</th>
                    <th scope="col">Category</th>
                    <th scope="col">Chains</th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      TVL
                    </th>
                    <th scope="col">Audit</th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Reports
                    </th>
                    <th scope="col">Links</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((p) => (
                    <tr key={p.protocolId}>
                      <td className="bam-cell-num">{p.priorityScore}</td>
                      <td>
                        <Link
                          href={`/workspace/protocols/${p.protocolId}`}
                          className="bam-cell-name"
                          style={{ textDecoration: "none" }}
                        >
                          {p.name}
                        </Link>{" "}
                        {p.isPinned ? (
                          <span className="bam-badge bam-badge--confirmed" style={{ marginLeft: "0.4rem" }}>
                            Pinned
                          </span>
                        ) : null}
                      </td>
                      <td style={{ color: "var(--bam-cream-60)" }}>{p.category ?? "—"}</td>
                      <td style={{ color: "var(--bam-cream-40)", fontSize: "var(--bam-t-micro)" }}>
                        {p.chains.length === 0
                          ? "—"
                          : p.chains.slice(0, 3).join(" · ") +
                            (p.chains.length > 3 ? ` +${p.chains.length - 3}` : "")}
                      </td>
                      <td className="bam-cell-num">{formatTvl(p.tvlUsd)}</td>
                      <td>
                        {p.auditStatus === "unaudited" ? (
                          <span className="bam-badge bam-badge--confirmed">
                            {auditStatusLabel(p.auditStatus)}
                          </span>
                        ) : (
                          <span style={{ color: "var(--bam-cream-40)" }}>
                            {auditStatusLabel(p.auditStatus)}
                          </span>
                        )}
                      </td>
                      <td className="bam-cell-num">
                        {p.auditCount}
                        {p.namedAuditCount > 0 ? (
                          <span style={{ color: "var(--bam-cream-40)" }}> ({p.namedAuditCount} named)</span>
                        ) : null}
                      </td>
                      <td style={{ color: "var(--bam-cream-60)" }}>
                        {p.website ? (
                          <a href={p.website} target="_blank" rel="noopener noreferrer nofollow">
                            site
                          </a>
                        ) : null}
                        {p.website && p.githubRepo ? " · " : null}
                        {p.githubRepo ? (
                          <a href={p.githubRepo} target="_blank" rel="noopener noreferrer nofollow">
                            code
                          </a>
                        ) : null}
                        {(p.website || p.githubRepo) && p.twitter ? " · " : null}
                        {p.twitter ? (
                          <a
                            href={`https://x.com/${p.twitter}`}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                          >
                            x
                          </a>
                        ) : null}
                        {!p.website && !p.githubRepo && !p.twitter ? "—" : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {list.rows.length === 0 ? (
                <p className="bam-body" style={{ padding: "var(--bam-space-xl) 0" }}>
                  {list.grandTotal === 0 ? (
                    <>
                      No protocols yet. Hit <strong>Sync</strong> above, or run{" "}
                      <code>npm run db:source</code> for the full set.
                    </>
                  ) : (
                    <>
                      Nothing matches that filter.{" "}
                      <Link href="/workspace">Reset</Link>.
                    </>
                  )}
                </p>
              ) : null}

              {pages > 1 ? (
                <div
                  style={{
                    display: "flex",
                    gap: "var(--bam-space-sm)",
                    marginTop: "var(--bam-space-lg)",
                    alignItems: "baseline",
                  }}
                >
                  {page > 1 ? (
                    <Link
                      href={withParam(params, "page", String(page - 1))}
                      className="bam-btn-sm"
                      style={{ textDecoration: "none" }}
                    >
                      ← Previous
                    </Link>
                  ) : null}
                  {page < pages ? (
                    <Link
                      href={withParam(params, "page", String(page + 1))}
                      className="bam-btn-sm"
                      style={{ textDecoration: "none" }}
                    >
                      Next →
                    </Link>
                  ) : null}
                  <span className="bam-eyebrow" style={{ color: "var(--bam-cream-40)" }}>
                    PAGE {page} OF {pages}
                  </span>
                </div>
              ) : null}
            </div>
          </Reveal>
        </section>

        {/* ─── Coverage tracking — only once something is pinned ──────── */}
        {queue.length > 0 ? (
          <section className="bam-pad-x" style={{ paddingBottom: "var(--bam-space-3xl)" }}>
            <Reveal>
              <p className="bam-eyebrow">
                {plural(counts.total, "PINNED CONTRACT")} · {counts.open} OPEN ·{" "}
                {counts.uncovered} UNCOVERED
              </p>
              <h2 className="bam-title">Coverage tracking.</h2>
              <p className="bam-body" style={{ maxWidth: "58ch", marginTop: "var(--bam-space-md)" }}>
                Contracts you have pinned, with the drift verdict where the commits
                are recorded. Entirely optional — the list above is the product;
                this is the deeper answer for targets that earn it.
              </p>

              <div className="bam-table-scroll" style={{ marginTop: "var(--bam-space-lg)" }}>
                <table className="bam-table">
                  <thead>
                    <tr>
                      <th scope="col">Target</th>
                      <th scope="col">Chain</th>
                      <th scope="col">Coverage</th>
                      <th scope="col" style={{ textAlign: "right" }}>
                        Drift
                      </th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.map((row) => (
                      <tr key={row.deploymentId}>
                        <td>
                          <Link
                            href={`/workspace/targets/${row.deploymentId}`}
                            className="bam-cell-name"
                            style={{ textDecoration: "none" }}
                          >
                            {row.protocolName}
                          </Link>{" "}
                          <span
                            style={{ fontSize: "var(--bam-t-micro)", color: "var(--bam-cream-40)" }}
                          >
                            {truncateAddress(row.addressOrProgramId)}
                          </span>
                        </td>
                        <td style={{ color: "var(--bam-cream-60)" }}>{chainLabel(row.chain)}</td>
                        <td>
                          <StateMarker state={row.coverageState} />
                        </td>
                        <td className="bam-cell-num">{formatDrift(row.driftDays)}</td>
                        <td style={{ color: "var(--bam-cream-60)" }}>
                          {queueStatusLabel(row.queueStatus)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Reveal>
          </section>
        ) : null}
      </main>
    </>
  );
}
