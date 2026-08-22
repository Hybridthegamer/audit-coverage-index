import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTER,
  fetchProtocols,
  normalizeProtocol,
  passesFilter,
  selectProtocols,
  type CurationFilter,
  type RawLlamaProtocol,
} from "./defillama";
import { filterFromEnv } from "./defillama.config";

/**
 * Fixture rows lifted from a real `GET /protocols` response (2026-08), trimmed
 * to the fields the normalizer reads. Every awkward shape the live feed
 * actually produces is represented, because each one broke something naive:
 *
 *   lido        the happy path — audits as a STRING, github as an ORG array
 *   slipstream  audits: "3" with an EMPTY audit_links (the feed disagreeing
 *               with itself; 1,100+ rows look like this)
 *   fresh-yield unaudited, no audit fields at all
 *   dust        below the TVL floor
 *   rugged-one  flagged rugged, comfortably above the floor
 *   ghost       dead URL, above the floor
 *   noslug      unusable: no slug, so no upsert key
 *   messy       hostile field types — numeric audits, @handle, ipfs url,
 *               duplicate audit links
 */
const FIXTURE: RawLlamaProtocol[] = [
  {
    name: "Lido",
    slug: "lido",
    url: "https://lido.fi/",
    twitter: "LidoFinance",
    category: "Liquid Staking",
    chains: ["Ethereum", "Solana"],
    tvl: 23_398_117_769.06,
    audits: "2",
    audit_links: ["https://github.com/lidofinance/audits"],
    github: ["lidofinance"],
  },
  {
    name: "Aerodrome Slipstream",
    slug: "aerodrome-slipstream",
    url: "https://aerodrome.finance",
    twitter: "aerodromefi",
    category: "Dexs",
    chains: ["Base"],
    tvl: 132_530_174,
    audits: "3",
    audit_links: [],
  },
  {
    name: "Fresh Yield",
    slug: "fresh-yield",
    url: "https://fresh.example",
    category: "Yield",
    chains: ["Arbitrum"],
    tvl: 42_000_000,
  },
  {
    name: "Dust Protocol",
    slug: "dust",
    category: "Dexs",
    chains: ["Ethereum"],
    tvl: 12_000,
    audits: "0",
  },
  {
    name: "Rugged One",
    slug: "rugged-one",
    category: "Yield",
    chains: ["BSC"],
    tvl: 9_000_000,
    rugged: true,
  },
  {
    name: "Ghost Finance",
    slug: "ghost",
    category: "Lending",
    chains: ["Polygon"],
    tvl: 5_000_000,
    deadUrl: "site down since 2024",
  },
  {
    name: "No Slug",
    url: "https://noslug.example",
    tvl: 500_000_000,
  },
  {
    name: "Messy Data",
    slug: "messy",
    url: "ipfs://QmSomething",
    twitter: "@Messy_DAO",
    category: "CDP",
    chains: ["Ethereum"],
    tvl: 3_000_000,
    audits: 1,
    audit_links: [
      "https://audits.example/messy.pdf",
      "https://audits.example/messy.pdf",
      "not-a-url",
    ],
    github: ["messy-dao"],
  },
];

describe("normalizeProtocol", () => {
  it("maps the happy path, including the string audit count and github org", () => {
    const lido = normalizeProtocol(FIXTURE[0]!);
    expect(lido).toEqual({
      slug: "lido",
      name: "Lido",
      website: "https://lido.fi/",
      twitter: "LidoFinance",
      githubRepo: "https://github.com/lidofinance",
      defillamaId: "lido",
      tvlUsd: 23_398_117_769.06,
      category: "Liquid Staking",
      chains: ["Ethereum", "Solana"],
      auditCount: 2,
      auditLinks: ["https://github.com/lidofinance/audits"],
      inactive: false,
    });
  });

  it("keeps the audit count when the feed publishes no links", () => {
    const slip = normalizeProtocol(FIXTURE[1]!);
    expect(slip?.auditCount).toBe(3);
    expect(slip?.auditLinks).toEqual([]);
  });

  it("reads a missing audits field as zero rather than NaN", () => {
    const fresh = normalizeProtocol(FIXTURE[2]!);
    expect(fresh?.auditCount).toBe(0);
    expect(fresh?.auditLinks).toEqual([]);
  });

  it("returns null when there is no slug to upsert on", () => {
    expect(normalizeProtocol(FIXTURE[6]!)).toBeNull();
  });

  it("sanitises hostile field shapes", () => {
    const messy = normalizeProtocol(FIXTURE[7]!);
    // Numeric audit count, not a string.
    expect(messy?.auditCount).toBe(1);
    // @handle stripped to a bare handle.
    expect(messy?.twitter).toBe("Messy_DAO");
    // ipfs:// is not a website.
    expect(messy?.website).toBeNull();
    // Duplicates collapsed, non-URLs dropped.
    expect(messy?.auditLinks).toEqual(["https://audits.example/messy.pdf"]);
  });

  it("flags rugged, deprecated and dead-link protocols as inactive", () => {
    expect(normalizeProtocol(FIXTURE[4]!)?.inactive).toBe(true);
    expect(normalizeProtocol(FIXTURE[5]!)?.inactive).toBe(true);
    expect(normalizeProtocol({ slug: "d", name: "D", deprecated: true })?.inactive).toBe(
      true,
    );
    expect(normalizeProtocol(FIXTURE[0]!)?.inactive).toBe(false);
  });

  it("treats a null TVL as unknown, not zero", () => {
    expect(normalizeProtocol({ slug: "x", name: "X" })?.tvlUsd).toBeNull();
    expect(normalizeProtocol({ slug: "x", name: "X", tvl: "lots" })?.tvlUsd).toBeNull();
  });
});

describe("passesFilter", () => {
  const at = (tvl: number | null, extra: Partial<RawLlamaProtocol> = {}) =>
    normalizeProtocol({ slug: "p", name: "P", tvl, category: "Dexs", chains: ["Base"], ...extra })!;

  it("applies the $1M–$50M band from DEFAULT_FILTER at both edges", () => {
    expect(passesFilter(at(999_999))).toBe(false);
    expect(passesFilter(at(1_000_000))).toBe(true);
    expect(passesFilter(at(50_000_000))).toBe(true);
    // Blue chips and CEXes sit above the ceiling on purpose.
    expect(passesFilter(at(50_000_001))).toBe(false);
    expect(passesFilter(at(160_000_000_000))).toBe(false);
  });

  it("treats maxTvlUsd 0 as no ceiling", () => {
    const uncapped: CurationFilter = { ...DEFAULT_FILTER, maxTvlUsd: 0 };
    expect(passesFilter(at(160_000_000_000), uncapped)).toBe(true);
    // The floor still applies with the ceiling lifted.
    expect(passesFilter(at(999_999), uncapped)).toBe(false);
  });

  it("rejects an unknown TVL — an unrankable row is not curated", () => {
    expect(passesFilter(at(null))).toBe(false);
  });

  it("honours the category allowlist case-insensitively", () => {
    const filter: CurationFilter = { ...DEFAULT_FILTER, categories: ["dexs"] };
    expect(passesFilter(at(5_000_000), filter)).toBe(true);
    expect(passesFilter(at(5_000_000, { category: "Lending" }), filter)).toBe(false);
  });

  it("matches the chain allowlist against ANY of a protocol's chains", () => {
    const filter: CurationFilter = { ...DEFAULT_FILTER, chains: ["Ethereum"] };
    expect(passesFilter(at(5_000_000, { chains: ["Base", "Ethereum"] }), filter)).toBe(
      true,
    );
    expect(passesFilter(at(5_000_000, { chains: ["Base"] }), filter)).toBe(false);
  });

  it("drops dead protocols by default and keeps them on request", () => {
    const rugged = at(5_000_000, { rugged: true });
    expect(passesFilter(rugged)).toBe(false);
    expect(passesFilter(rugged, { ...DEFAULT_FILTER, includeInactive: true })).toBe(true);
  });
});

describe("selectProtocols", () => {
  /** The band is the default; lift it when a test is about something else. */
  const uncapped: CurationFilter = { ...DEFAULT_FILTER, maxTvlUsd: 0 };

  it("curates the fixture to the live, funded, usable rows only", () => {
    const selected = selectProtocols(FIXTURE, uncapped);
    expect(selected.map((p) => p.slug)).toEqual([
      "lido", // $23B
      "aerodrome-slipstream", // $132M
      "fresh-yield", // $42M
      "messy", // $3M
    ]);
  });

  it("keeps only the $1M–$50M band by default", () => {
    // Lido ($23B) and Slipstream ($132M) are above the ceiling; Dust ($12K)
    // is below the floor.
    expect(selectProtocols(FIXTURE).map((p) => p.slug)).toEqual([
      "fresh-yield", // $42M
      "messy", // $3M
    ]);
  });

  it("ranks by TVL descending so a cap keeps the biggest, not the first listed", () => {
    const selected = selectProtocols(FIXTURE, { ...uncapped, maxProtocols: 2 });
    expect(selected.map((p) => p.slug)).toEqual(["lido", "aerodrome-slipstream"]);
  });

  it("collapses duplicate slugs, keeping the richer row", () => {
    const dupes: RawLlamaProtocol[] = [
      { slug: "dup", name: "Dup", tvl: 2_000_000 },
      { slug: "dup", name: "Dup (parent)", tvl: 9_000_000 },
    ];
    const selected = selectProtocols(dupes);
    expect(selected).toHaveLength(1);
    expect(selected[0]!.tvlUsd).toBe(9_000_000);
  });

  it("returns an empty set rather than throwing on an empty feed", () => {
    expect(selectProtocols([])).toEqual([]);
  });
});

describe("fetchProtocols", () => {
  const okResponse = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("identifies itself and returns the curated set", async () => {
    let seenUrl = "";
    let seenUa: string | null = null;

    const records = await fetchProtocols(DEFAULT_FILTER, {
      fetchImpl: async (input, init) => {
        seenUrl = String(input);
        seenUa = new Headers(init?.headers).get("user-agent");
        return okResponse(FIXTURE);
      },
    });

    expect(seenUrl).toBe("https://api.llama.fi/protocols");
    expect(seenUa).toContain("audit-coverage-index");
    // The band applies to the fetched set, not only to selectProtocols.
    expect(records.map((p) => p.slug)).toEqual(["fresh-yield", "messy"]);
  });

  it("throws on a non-2xx response instead of importing nothing silently", async () => {
    await expect(
      fetchProtocols(DEFAULT_FILTER, {
        fetchImpl: async () => new Response("upstream down", { status: 503 }),
      }),
    ).rejects.toThrow(/503/);
  });

  it("throws when the payload is not an array", async () => {
    await expect(
      fetchProtocols(DEFAULT_FILTER, {
        fetchImpl: async () => okResponse({ error: "nope" }),
      }),
    ).rejects.toThrow(/did not return an array/);
  });
});

describe("filterFromEnv", () => {
  it("falls back to the agreed defaults on an empty environment", () => {
    expect(filterFromEnv({})).toEqual(DEFAULT_FILTER);
  });

  it("parses every knob", () => {
    expect(
      filterFromEnv({
        DEFILLAMA_MIN_TVL_USD: "5_000_000",
        DEFILLAMA_MAX_TVL_USD: "0",
        DEFILLAMA_CATEGORIES: "Dexs, Lending ,",
        DEFILLAMA_CHAINS: "Ethereum",
        DEFILLAMA_INCLUDE_INACTIVE: "true",
        DEFILLAMA_MAX_PROTOCOLS: "250",
      }),
    ).toEqual({
      minTvlUsd: 5_000_000,
      maxTvlUsd: 0,
      categories: ["Dexs", "Lending"],
      chains: ["Ethereum"],
      includeInactive: true,
      maxProtocols: 250,
    });
  });

  it("keeps the $50M ceiling unless the environment lifts it", () => {
    expect(filterFromEnv({}).maxTvlUsd).toBe(50_000_000);
    expect(filterFromEnv({ DEFILLAMA_MAX_TVL_USD: "0" }).maxTvlUsd).toBe(0);
    expect(filterFromEnv({ DEFILLAMA_MAX_TVL_USD: "250000000" }).maxTvlUsd).toBe(
      250_000_000,
    );
  });

  it("ignores unparseable values rather than aborting a sourcing run", () => {
    const filter = filterFromEnv({
      DEFILLAMA_MIN_TVL_USD: "quite a lot",
      DEFILLAMA_INCLUDE_INACTIVE: "maybe",
      DEFILLAMA_CATEGORIES: "  ",
    });
    expect(filter.minTvlUsd).toBe(DEFAULT_FILTER.minTvlUsd);
    expect(filter.includeInactive).toBe(false);
    expect(filter.categories).toBeNull();
  });
});
