/**
 * DefiLlama source module (build step 6).
 *
 * The first EXTERNAL data source in the project. Everything before it either
 * recomputed rows already in the database (lib/ingest.ts) or wrote five
 * hand-written protocols (db/seed.ts); this is where the platform starts
 * populating itself.
 *
 * Shape of the module, deliberately:
 *   · the network lives here and nowhere else in the sourcing path
 *   · it imports NO database client and NO drizzle schema — it hands back
 *     plain normalized records, and lib/ingest.ts (which takes `db` as an
 *     argument) is what writes them
 *   · every decision that turns a raw feed row into a curated record is a pure
 *     exported function, so the whole curation policy is unit-testable against
 *     a fixture with no network and no DB
 *
 * What DefiLlama can and cannot tell us (the important nuance):
 *   · CAN: this protocol exists, its TVL, chains, category, links, and whether
 *     it was audited at all plus where the reports live.
 *   · CANNOT: the reviewed commit, the report date, the auditor name, or the
 *     addresses of the deployed contracts.
 * So this module feeds the CURATION layer — audited vs unaudited, ranked by
 * money — and never pretends to know commit-level coverage. computeDrift()'s
 * `current`/`drifted`/`uncovered` still needs both commits, which step 7 pins
 * from block explorers. Sourced protocols honestly compute to `unknown` until
 * then, and that is the correct answer, not a gap.
 */

export const DEFILLAMA_API_BASE = "https://api.llama.fi";

/**
 * Identify ourselves. DefiLlama's free API has no key and no published rate
 * limit; a real User-Agent is the minimum courtesy owed to an endpoint that
 * ships 8MB per call.
 */
export const DEFILLAMA_USER_AGENT =
  "audit-coverage-index/0.1 (+https://github.com/audit-coverage-index)";

/* ------------------------------------------------------------------ *
 * Raw feed shape
 * ------------------------------------------------------------------ */

/**
 * The subset of `GET /protocols` we read, verified against a live response.
 * Everything is optional because the feed is not a contract: of 8,100 rows,
 * `audits` and `twitter` are missing on some, `chain` on ~1,100, `audit_links`
 * on two thirds, and `audits` itself arrives as a STRING ("0", "2", "5") or
 * null. Nothing here is trusted to be present or well-typed — normalize() is
 * the only place that assumption is made, and it is made defensively.
 */
export interface RawLlamaProtocol {
  id?: unknown;
  name?: unknown;
  slug?: unknown;
  url?: unknown;
  twitter?: unknown;
  category?: unknown;
  chain?: unknown;
  chains?: unknown;
  tvl?: unknown;
  audits?: unknown;
  audit_links?: unknown;
  github?: unknown;
  /** Set when DefiLlama has flagged the project as an exit scam. */
  rugged?: unknown;
  deprecated?: unknown;
  /** Present (as a string reason) when the project site stopped resolving. */
  deadUrl?: unknown;
  deadFrom?: unknown;
}

/* ------------------------------------------------------------------ *
 * Normalized record
 * ------------------------------------------------------------------ */

/** One curated protocol, in the shape lib/ingest.ts writes to the DB. */
export interface SourcedProtocol {
  /** DefiLlama's slug. The stable upsert key against `protocols.slug`. */
  slug: string;
  name: string;
  website: string | null;
  /** Bare handle, e.g. `aave` — the same convention db/seed.ts uses. */
  twitter: string | null;
  /** `https://github.com/<org>` from the feed's org list, or null. */
  githubRepo: string | null;
  /** Mirrors `slug`; stored so a row's provenance is legible in the DB. */
  defillamaId: string;
  tvlUsd: number | null;
  category: string | null;
  /** DefiLlama's own chain names ("Ethereum", "BNB"), not our chain enum. */
  chains: string[];
  /** The feed's audit COUNT. Can exceed auditLinks.length — see planAuditRows. */
  auditCount: number;
  auditLinks: string[];
  /** Rugged, deprecated, or dead-linked. Excluded from curation by default. */
  inactive: boolean;
}

/* ------------------------------------------------------------------ *
 * Curation filter
 * ------------------------------------------------------------------ */

export interface CurationFilter {
  /** Floor in USD. Below it a protocol is not worth a week of review. */
  minTvlUsd: number;
  /** Ceiling in USD. 0 = no ceiling. See DEFAULT_FILTER for why there is one. */
  maxTvlUsd: number;
  /** Case-insensitive allowlist of DefiLlama categories; null = all. */
  categories: string[] | null;
  /** Case-insensitive allowlist of DefiLlama chain names; null = all. */
  chains: string[] | null;
  /** Include rugged / deprecated / dead-link protocols. */
  includeInactive: boolean;
  /** Hard cap after ranking by TVL. 0 = no cap. */
  maxProtocols: number;
}

/**
 * The agreed step-6 curation: a $1M–$50M TVL BAND, every category, every chain.
 *
 * The band is deliberate on both edges. The floor drops protocols too small to
 * be worth a week of review. The ceiling drops the giants — at "all categories"
 * the top of the list is centralised exchanges and blue chips (Binance CEX at
 * $160B, Lido, Aave), which have standing audit relationships, in-house
 * security teams, and a queue of researchers already on them. The band is where
 * an unaudited protocol still holding real money actually lives.
 *
 * Both edges are env knobs (DEFILLAMA_MIN_TVL_USD / DEFILLAMA_MAX_TVL_USD, the
 * latter 0 for no ceiling), so widening is a config change, not a deploy.
 *
 * Only dead projects are dropped beyond that — a rugged or deprecated protocol
 * has no live code worth reviewing and no team left to disclose to, so it is
 * noise in a hunting queue rather than a target. Set
 * DEFILLAMA_INCLUDE_INACTIVE=true to keep them.
 */
export const DEFAULT_FILTER: CurationFilter = {
  minTvlUsd: 1_000_000,
  maxTvlUsd: 50_000_000,
  categories: null,
  chains: null,
  includeInactive: false,
  maxProtocols: 0,
};

/* ------------------------------------------------------------------ *
 * Normalization (pure)
 * ------------------------------------------------------------------ */

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The feed sends audit counts as strings ("2"); tolerate numbers too. */
function asCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  const str = asTrimmedString(value);
  if (str === null) return 0;
  const n = Number(str);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const str = asTrimmedString(entry);
    if (str !== null) out.push(str);
  }
  return out;
}

function isHttpish(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** Only http(s) survives. The feed carries the odd `ipfs://` and bare word. */
function asHttpUrl(value: unknown): string | null {
  const str = asTrimmedString(value);
  if (str === null) return null;
  try {
    const parsed = new URL(str);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** `@Aave`, a full profile URL, or a bare handle all reduce to `Aave`. */
function asTwitterHandle(value: unknown): string | null {
  const str = asTrimmedString(value);
  if (str === null) return null;
  const stripped = str
    .replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "")
    .replace(/^@/, "");
  const handle = (stripped.split(/[/?#]/)[0] ?? "").trim();
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

/**
 * The feed's `github` is an array of ORG names (`["lidofinance"]`), not repo
 * URLs. An org page is still the right starting point for finding the
 * contracts and the /audits folder, so it is stored as a URL and step 7
 * narrows it to the actual repo.
 */
function asGithubUrl(value: unknown): string | null {
  const [org] = asStringArray(value);
  if (org === undefined) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(org)) return null;
  return `https://github.com/${org}`;
}

/**
 * One raw feed row → one curated record, or null when the row is unusable.
 * A row is unusable only when it has no slug or no name: without a slug there
 * is no stable upsert key, and the entire sync is keyed on it.
 */
export function normalizeProtocol(raw: RawLlamaProtocol): SourcedProtocol | null {
  const slug = asTrimmedString(raw.slug);
  const name = asTrimmedString(raw.name);
  if (slug === null || name === null) return null;

  const tvl = typeof raw.tvl === "number" && Number.isFinite(raw.tvl) ? raw.tvl : null;

  // Dedupe links: the feed occasionally repeats the same report URL.
  const auditLinks = [...new Set(asStringArray(raw.audit_links).filter(isHttpish))];

  return {
    slug,
    name,
    website: asHttpUrl(raw.url),
    twitter: asTwitterHandle(raw.twitter),
    githubRepo: asGithubUrl(raw.github),
    defillamaId: slug,
    tvlUsd: tvl,
    category: asTrimmedString(raw.category),
    chains: asStringArray(raw.chains),
    auditCount: asCount(raw.audits),
    auditLinks,
    inactive:
      raw.rugged === true ||
      raw.deprecated === true ||
      raw.deadUrl === true ||
      asTrimmedString(raw.deadUrl) !== null,
  };
}

/* ------------------------------------------------------------------ *
 * Curation (pure)
 * ------------------------------------------------------------------ */

function matchesAllowlist(values: string[], allowed: string[] | null): boolean {
  if (allowed === null || allowed.length === 0) return true;
  const lower = new Set(allowed.map((a) => a.toLowerCase()));
  return values.some((v) => lower.has(v.toLowerCase()));
}

/** The curation predicate, one protocol at a time. */
export function passesFilter(
  protocol: SourcedProtocol,
  filter: CurationFilter = DEFAULT_FILTER,
): boolean {
  if (protocol.inactive && !filter.includeInactive) return false;
  if (protocol.tvlUsd === null || protocol.tvlUsd < filter.minTvlUsd) return false;
  if (filter.maxTvlUsd > 0 && protocol.tvlUsd > filter.maxTvlUsd) return false;

  const categories = protocol.category === null ? [] : [protocol.category];
  if (!matchesAllowlist(categories, filter.categories)) return false;
  if (!matchesAllowlist(protocol.chains, filter.chains)) return false;

  return true;
}

/**
 * The whole feed → the curated, ranked import set. Normalizes, filters, drops
 * duplicate slugs (keeping the richer row), sorts by TVL descending, and
 * applies the cap. Sorting before the cap is what makes `maxProtocols` mean
 * "the biggest N" rather than "whatever the feed happened to list first".
 */
export function selectProtocols(
  raws: readonly RawLlamaProtocol[],
  filter: CurationFilter = DEFAULT_FILTER,
): SourcedProtocol[] {
  const bySlug = new Map<string, SourcedProtocol>();

  for (const raw of raws) {
    const normalized = normalizeProtocol(raw);
    if (normalized === null) continue;
    if (!passesFilter(normalized, filter)) continue;

    const existing = bySlug.get(normalized.slug);
    if (existing === undefined || (normalized.tvlUsd ?? 0) > (existing.tvlUsd ?? 0)) {
      bySlug.set(normalized.slug, normalized);
    }
  }

  const ranked = [...bySlug.values()].sort(
    (a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0) || a.slug.localeCompare(b.slug),
  );

  return filter.maxProtocols > 0 ? ranked.slice(0, filter.maxProtocols) : ranked;
}

/* ------------------------------------------------------------------ *
 * Network
 * ------------------------------------------------------------------ */

export interface FetchOptions {
  /** Injectable for tests and for an in-app run with a shorter budget. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Fetch the full protocol list and return the curated set. One request — the
 * list endpoint already carries every field step 6 maps, so `/protocol/{slug}`
 * (which would be 1,276 further calls) is deliberately not used here.
 */
export async function fetchProtocols(
  filter: CurationFilter = DEFAULT_FILTER,
  options: FetchOptions = {},
): Promise<SourcedProtocol[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${DEFILLAMA_API_BASE}/protocols`, {
    headers: { "User-Agent": DEFILLAMA_USER_AGENT, accept: "application/json" },
    signal: options.signal,
    // 8MB of slow-moving data: never serve it from a stale Next data cache,
    // and never let one run fetch it twice.
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `DefiLlama /protocols responded ${response.status} ${response.statusText}`,
    );
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("DefiLlama /protocols did not return an array");
  }

  return selectProtocols(payload as RawLlamaProtocol[], filter);
}
