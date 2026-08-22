/**
 * Block-explorer source module (build step 7).
 *
 * The second EXTERNAL data source, and the one that answers the question
 * DefiLlama structurally cannot: what is actually deployed on-chain.
 *
 * Step 6 imported ~900 protocols with TVL, links and audit *presence* and
 * stopped there, because `deployments.address_or_program_id` is NOT NULL and
 * the DefiLlama feed has no per-contract addresses. Everything it sourced
 * therefore has zero deployment rows and computes to `unknown`. This module is
 * what pins the contracts: given one address on one chain it resolves the
 * facts the drift engine needs — when the code was deployed, whether it sits
 * behind a proxy, what the current implementation and admin are, and every
 * upgrade the proxy has ever emitted.
 *
 * Shape, identical in spirit to lib/sources/defillama.ts:
 *   · the network lives here and nowhere else in this path
 *   · NO database client and NO drizzle schema is imported — it returns plain
 *     records and lib/ingest.ts (which takes `db` as an argument) writes them
 *   · every decode/parse/derive step is a pure exported function, unit-tested
 *     against fixtures, because explorer responses are as hostile as the
 *     DefiLlama feed: `status` is the string "0" for both "no records" and a
 *     real failure, numbers arrive as hex in one endpoint and decimal in
 *     another, and the proxy module answers in JSON-RPC while the rest answers
 *     in Etherscan's own envelope.
 *
 * WHAT THIS MODULE WILL NOT DO — the honest boundary, and the reason step 7 is
 * not simply "run it and coverage lights up":
 *
 *   A block explorer does not know a git commit. It has bytecode and, when the
 *   contract is verified, source text — never the commit that produced it. So
 *   `deployments.deployed_commit` is NOT written here and never will be. This
 *   module establishes everything AROUND the commit (address, dates, proxy,
 *   upgrades); the researcher pins the commit itself in the workspace, and only
 *   then does computeDrift() have both halves it needs.
 *
 *   Writing a guessed commit would put a fabricated value into the one number
 *   the public index exists to state. `unknown` until a human pins it is the
 *   correct answer, exactly as it was in step 6.
 */

/* ------------------------------------------------------------------ *
 * Chains
 * ------------------------------------------------------------------ */

/**
 * Etherscan V2 is one API across every chain it covers: the same host, the
 * same key, `chainid` selecting the network. That is why this module is not
 * three near-identical Etherscan/Basescan/Arbiscan clients.
 *
 * Only the EVM members of our `chain` enum appear here. Solana, Stacks, Aptos,
 * Sui, the Cosmos chains, Starknet and TON have no Etherscan equivalent and are
 * reported as unsupported rather than silently skipped — a Solana program is
 * still pinned by hand, it just cannot be auto-resolved.
 */
export const EXPLORER_CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  optimism: 10,
  bsc: 56,
  polygon: 137,
  base: 8453,
  arbitrum: 42161,
};

/** Human-facing explorer origins, used to build `deployments.explorer_url`. */
export const EXPLORER_ORIGINS: Record<string, string> = {
  ethereum: "https://etherscan.io",
  optimism: "https://optimistic.etherscan.io",
  bsc: "https://bscscan.com",
  polygon: "https://polygonscan.com",
  base: "https://basescan.org",
  arbitrum: "https://arbiscan.io",
};

export function isSupportedChain(chain: string): boolean {
  return chain in EXPLORER_CHAIN_IDS;
}

/** Every chain this module can resolve, for UI that must say so up front. */
export const SUPPORTED_CHAINS: readonly string[] = Object.keys(EXPLORER_CHAIN_IDS);

/** A per-address explorer link, or null for an unsupported chain. */
export function explorerAddressUrl(chain: string, address: string): string | null {
  const origin = EXPLORER_ORIGINS[chain];
  if (origin === undefined) return null;
  return `${origin}/address/${address}`;
}

/* ------------------------------------------------------------------ *
 * Addresses
 * ------------------------------------------------------------------ */

/**
 * Addresses are stored lowercase from step 7 on, and the unique index that
 * stops a contract being pinned twice is keyed on `lower(address)`, so a
 * checksummed paste and a lowercase one are the same row. Checksum casing
 * carries no information the explorer needs; losing it costs nothing and
 * de-duplicating is worth real money in a research queue.
 */
export function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

/** A 20-byte hex address — the only thing this module will send to an explorer. */
export function isEvmAddress(value: string): boolean {
  return /^0x[0-9a-f]{40}$/.test(normalizeAddress(value));
}

/** The zero address, which EIP-1967 slots return when a contract is not a proxy. */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * A 32-byte storage word → the address in its low 20 bytes.
 *
 * Returns null for an empty slot, the zero address, or a malformed word: an
 * unset proxy slot means "not a proxy", never "an address of all zeroes".
 */
export function addressFromStorageWord(word: unknown): string | null {
  if (typeof word !== "string") return null;
  const hex = word.trim().toLowerCase();
  if (!/^0x[0-9a-f]{1,64}$/.test(hex)) return null;
  const padded = hex.slice(2).padStart(64, "0");
  const address = `0x${padded.slice(24)}`;
  if (address === ZERO_ADDRESS) return null;
  return isEvmAddress(address) ? address : null;
}

/* ------------------------------------------------------------------ *
 * Proxy storage slots
 * ------------------------------------------------------------------ */

/**
 * The standardised proxy slots, in the order they are probed.
 *
 * EIP-1967 first, because it is what every current proxy uses (OpenZeppelin
 * Transparent and UUPS, and everything that copied them). The legacy
 * `org.zeppelinos` slot is still live under contracts deployed in 2019-2020
 * that hold real money — precisely the population this queue cares about. The
 * beacon slot is read for detection only: the implementation behind a beacon
 * lives in the beacon contract, one hop further out, so we record that the
 * deployment is upgradeable and let the researcher follow the pointer rather
 * than inventing an implementation address.
 */
export const PROXY_SLOTS = {
  /** keccak256("eip1967.proxy.implementation") - 1 */
  eip1967Implementation:
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  /** keccak256("eip1967.proxy.admin") - 1 */
  eip1967Admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
  /** keccak256("eip1967.proxy.beacon") - 1 */
  eip1967Beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  /** keccak256("org.zeppelinos.proxy.implementation") — pre-1967 OZ proxies */
  zeppelinosImplementation:
    "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
} as const;

/**
 * topic0 of `Upgraded(address)` — the EIP-1967 event every standard proxy emits
 * when its implementation changes. This is the primary source of
 * `deployments.last_upgraded_at`, and each log becomes an `upgrade_events` row:
 * the on-chain record of when unreviewed code went live.
 */
export const UPGRADED_TOPIC0 =
  "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b";

/* ------------------------------------------------------------------ *
 * Resolved record
 * ------------------------------------------------------------------ */

/** One upgrade, decoded from an `Upgraded(address)` log. */
export interface ResolvedUpgrade {
  occurredAt: Date;
  txHash: string | null;
  /** The new implementation, from the log's indexed address topic. */
  newImplementation: string | null;
  blockNumber: number | null;
}

export type ProxyKind =
  | "none"
  | "eip1967"
  | "eip1967-beacon"
  | "zeppelinos"
  | "explorer-flag";

/**
 * Everything the explorer could establish about one address.
 *
 * Every field is nullable because every one of them can genuinely be
 * unavailable — an unverified contract, a chain whose explorer has no creation
 * index, a proxy that predates the Upgraded event. A null here means "not
 * established", which is a different claim from "false", and lib/ingest.ts is
 * careful never to overwrite a recorded value with one.
 */
export interface ResolvedDeployment {
  chain: string;
  address: string;
  /** Verified contract name, e.g. `TransparentUpgradeableProxy`. */
  contractName: string | null;
  /** True when the explorer holds verified source for the address. */
  sourceVerified: boolean;
  /** True when a proxy slot or the explorer's own flag says so. */
  isUpgradeable: boolean;
  /** Current implementation behind the proxy, when one was resolved. */
  implementation: string | null;
  /** EIP-1967 admin — who can upgrade. Written to `upgrade_authority`. */
  upgradeAuthority: string | null;
  /** How upgradeability was established, for the researcher's benefit. */
  proxyKind: ProxyKind;
  /** Contract creation timestamp → `deployments.deployed_at`. */
  deployedAt: Date | null;
  /** Creation transaction hash. */
  creationTxHash: string | null;
  /** Deployer EOA or factory. */
  creator: string | null;
  /** Latest upgrade → `deployments.last_upgraded_at`. Null = never upgraded. */
  lastUpgradedAt: Date | null;
  /** Every `Upgraded(address)` log, oldest first. */
  upgrades: ResolvedUpgrade[];
  explorerUrl: string | null;
  /** Non-fatal problems, surfaced rather than swallowed. */
  warnings: string[];
}

/* ------------------------------------------------------------------ *
 * Response parsing (pure)
 * ------------------------------------------------------------------ */

/**
 * Etherscan's envelope is `{ status, message, result }`, and `status: "0"` is
 * overloaded: it means both "no records found" — a perfectly good empty answer
 * for a contract that has never been upgraded — and "you are rate limited" or
 * "invalid key", a real failure that must not be read as "no upgrades".
 *
 * Conflating those would silently record a busy proxy as never upgraded, and
 * `last_upgraded_at` is a public number. The two are separated here, by
 * message, and the separation is tested.
 */
export type EnvelopeOutcome =
  | { kind: "ok"; result: unknown }
  | { kind: "empty" }
  | { kind: "error"; message: string };

const EMPTY_MESSAGES = ["no records found", "no transactions found", "no logs found"];

export function readEnvelope(payload: unknown): EnvelopeOutcome {
  if (payload === null || typeof payload !== "object") {
    return { kind: "error", message: "explorer returned a non-object payload" };
  }
  const body = payload as Record<string, unknown>;

  // The proxy module answers in JSON-RPC, not the Etherscan envelope.
  if ("jsonrpc" in body) {
    const rpcError = body.error;
    if (rpcError !== undefined && rpcError !== null) {
      const message =
        typeof rpcError === "object" && "message" in (rpcError as object)
          ? String((rpcError as Record<string, unknown>).message)
          : "json-rpc error";
      return { kind: "error", message };
    }
    return { kind: "ok", result: body.result };
  }

  const status = typeof body.status === "string" ? body.status : null;
  const message = typeof body.message === "string" ? body.message : "";

  if (status === "1") return { kind: "ok", result: body.result };

  if (EMPTY_MESSAGES.includes(message.trim().toLowerCase())) return { kind: "empty" };

  // Some endpoints put the detail in `result` rather than `message`.
  const detail =
    typeof body.result === "string" && body.result.length > 0
      ? body.result
      : message.length > 0
        ? message
        : "explorer request failed";
  return { kind: "error", message: detail };
}

/** Hex (`0x63…`) or decimal string → a finite number, else null. */
export function parseNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw.length === 0) return null;
  const n = /^0x[0-9a-fA-F]+$/.test(raw) ? Number.parseInt(raw, 16) : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** A unix-seconds timestamp, hex or decimal, → Date. Rejects 0 and garbage. */
export function parseUnixSeconds(value: unknown): Date | null {
  const seconds = parseNumeric(value);
  if (seconds === null || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The verified-source payload, as much of it as this module reads. */
export interface RawSourceCode {
  ContractName?: unknown;
  ABI?: unknown;
  Proxy?: unknown;
  Implementation?: unknown;
  SourceCode?: unknown;
}

export interface SourceCodeFacts {
  contractName: string | null;
  sourceVerified: boolean;
  /** The explorer's own proxy flag — a weaker signal than a storage read. */
  explorerSaysProxy: boolean;
  /** The explorer's recorded implementation, when it has one. */
  implementation: string | null;
}

const UNVERIFIED_ABI = "contract source code not verified";

/**
 * Decode `contract/getsourcecode`. The unverified case is signalled in-band — a
 * 200 with `ABI: "Contract source code not verified"` and empty source — so
 * "verified" is decided on content, not on the HTTP status.
 */
export function readSourceCode(result: unknown): SourceCodeFacts {
  const entry = Array.isArray(result) ? result[0] : result;
  if (entry === null || typeof entry !== "object") {
    return {
      contractName: null,
      sourceVerified: false,
      explorerSaysProxy: false,
      implementation: null,
    };
  }
  const raw = entry as RawSourceCode;

  const abi = typeof raw.ABI === "string" ? raw.ABI.trim() : "";
  const source = typeof raw.SourceCode === "string" ? raw.SourceCode.trim() : "";
  const sourceVerified =
    abi.length > 0 && abi.toLowerCase() !== UNVERIFIED_ABI && source.length > 0;

  const name = typeof raw.ContractName === "string" ? raw.ContractName.trim() : "";
  const implementation =
    typeof raw.Implementation === "string" ? normalizeAddress(raw.Implementation) : "";

  return {
    contractName: name.length > 0 ? name : null,
    sourceVerified,
    explorerSaysProxy: String(raw.Proxy ?? "").trim() === "1",
    implementation:
      isEvmAddress(implementation) && implementation !== ZERO_ADDRESS
        ? implementation
        : null,
  };
}

/** One raw log from `logs/getLogs`. */
export interface RawLog {
  topics?: unknown;
  timeStamp?: unknown;
  transactionHash?: unknown;
  blockNumber?: unknown;
}

/**
 * `Upgraded(address)` logs → upgrade records, oldest first.
 *
 * The new implementation is `topics[1]`: the event's single parameter is
 * indexed, so it arrives as a 32-byte topic word rather than in `data`. A log
 * with no timestamp is dropped — `upgrade_events.occurred_at` is NOT NULL, and
 * an upgrade we cannot date is not an upgrade we can reason about.
 */
export function readUpgradeLogs(result: unknown): ResolvedUpgrade[] {
  if (!Array.isArray(result)) return [];

  const upgrades: ResolvedUpgrade[] = [];
  for (const entry of result) {
    if (entry === null || typeof entry !== "object") continue;
    const log = entry as RawLog;

    const occurredAt = parseUnixSeconds(log.timeStamp);
    if (occurredAt === null) continue;

    const topics = Array.isArray(log.topics) ? log.topics : [];

    upgrades.push({
      occurredAt,
      txHash:
        typeof log.transactionHash === "string" && log.transactionHash.length > 0
          ? log.transactionHash.toLowerCase()
          : null,
      newImplementation: addressFromStorageWord(topics[1]),
      blockNumber: parseNumeric(log.blockNumber),
    });
  }

  return upgrades.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

/** One entry from `contract/getcontractcreation`. */
export interface RawCreation {
  contractCreator?: unknown;
  txHash?: unknown;
  blockNumber?: unknown;
  timestamp?: unknown;
}

export interface CreationFacts {
  creator: string | null;
  txHash: string | null;
  blockNumber: number | null;
  /** Present on newer responses; older ones need a separate block lookup. */
  deployedAt: Date | null;
}

export function readCreation(result: unknown): CreationFacts | null {
  const entry = Array.isArray(result) ? result[0] : result;
  if (entry === null || typeof entry !== "object") return null;
  const raw = entry as RawCreation;

  const creator =
    typeof raw.contractCreator === "string" ? normalizeAddress(raw.contractCreator) : "";
  const txHash = typeof raw.txHash === "string" ? raw.txHash.toLowerCase() : "";

  return {
    creator: isEvmAddress(creator) ? creator : null,
    txHash: /^0x[0-9a-f]{64}$/.test(txHash) ? txHash : null,
    blockNumber: parseNumeric(raw.blockNumber),
    deployedAt: parseUnixSeconds(raw.timestamp),
  };
}

/* ------------------------------------------------------------------ *
 * Derivation (pure)
 * ------------------------------------------------------------------ */

export interface ProxyProbe {
  eip1967Implementation: string | null;
  eip1967Admin: string | null;
  eip1967Beacon: string | null;
  zeppelinosImplementation: string | null;
}

export interface ProxyVerdict {
  isUpgradeable: boolean;
  implementation: string | null;
  upgradeAuthority: string | null;
  kind: ProxyKind;
}

/**
 * Four storage reads plus the explorer's flag → one verdict.
 *
 * Storage beats the flag deliberately. The explorer's `Proxy: "1"` is a
 * curation field a human set when the contract was verified; the slot is what
 * the EVM will actually delegate to this afternoon. When only the flag fires,
 * the deployment is still marked upgradeable — a custom proxy the standard
 * slots miss is exactly the sort of contract worth reviewing — but `kind`
 * records that it rested on the weaker signal.
 */
export function deriveProxy(probe: ProxyProbe, explorerSaysProxy: boolean): ProxyVerdict {
  if (probe.eip1967Implementation !== null) {
    return {
      isUpgradeable: true,
      implementation: probe.eip1967Implementation,
      upgradeAuthority: probe.eip1967Admin,
      kind: "eip1967",
    };
  }
  if (probe.eip1967Beacon !== null) {
    return {
      isUpgradeable: true,
      // The implementation lives inside the beacon, one hop further out.
      implementation: null,
      upgradeAuthority: probe.eip1967Beacon,
      kind: "eip1967-beacon",
    };
  }
  if (probe.zeppelinosImplementation !== null) {
    return {
      isUpgradeable: true,
      implementation: probe.zeppelinosImplementation,
      upgradeAuthority: probe.eip1967Admin,
      kind: "zeppelinos",
    };
  }
  if (explorerSaysProxy) {
    return {
      isUpgradeable: true,
      implementation: null,
      upgradeAuthority: null,
      kind: "explorer-flag",
    };
  }
  return {
    isUpgradeable: false,
    implementation: null,
    upgradeAuthority: null,
    kind: "none",
  };
}

/**
 * `last_upgraded_at` from the upgrade log.
 *
 * Null when nothing was ever emitted, and null is the meaningful answer:
 * computeDrift reads "no upgrade since the covering audit" as `current`. An
 * empty upgrade history is a claim about the contract, not missing data —
 * which is why readEnvelope keeps "no records found" separate from a failure.
 */
export function lastUpgradedAt(upgrades: readonly ResolvedUpgrade[]): Date | null {
  let latest: Date | null = null;
  for (const upgrade of upgrades) {
    if (latest === null || upgrade.occurredAt.getTime() > latest.getTime()) {
      latest = upgrade.occurredAt;
    }
  }
  return latest;
}

/* ------------------------------------------------------------------ *
 * Network
 * ------------------------------------------------------------------ */

export const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";

export interface ExplorerOptions {
  apiKey: string;
  /** Injectable for tests and for an in-app run with a shorter budget. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /**
   * Milliseconds between requests. Etherscan's free tier is 5 calls/second and
   * a single address costs 7, so a naive burst gets throttled — and a throttle
   * arrives as `status: "0"`, which readEnvelope must not mistake for "no
   * records". Pacing is cheaper than parsing our way out of that.
   */
  throttleMs?: number;
}

const DEFAULT_THROTTLE_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One Etherscan V2 call. Returns the parsed envelope rather than throwing on a
 * logical failure, so a caller can tell "this contract has no upgrades" from
 * "this key is rate limited" — the distinction the whole module turns on.
 */
async function call(
  chainId: number,
  params: Record<string, string>,
  options: ExplorerOptions,
): Promise<EnvelopeOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL(ETHERSCAN_V2_BASE);
  url.searchParams.set("chainid", String(chainId));
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("apikey", options.apiKey);

  const response = await fetchImpl(url.toString(), {
    headers: { accept: "application/json" },
    signal: options.signal,
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      kind: "error",
      message: `explorer responded ${response.status} ${response.statusText}`,
    };
  }

  return readEnvelope((await response.json()) as unknown);
}

/** Read one storage slot through the JSON-RPC proxy module. */
async function readSlot(
  chainId: number,
  address: string,
  position: string,
  options: ExplorerOptions,
): Promise<string | null> {
  const outcome = await call(
    chainId,
    {
      module: "proxy",
      action: "eth_getStorageAt",
      address,
      position,
      tag: "latest",
    },
    options,
  );
  return outcome.kind === "ok" ? addressFromStorageWord(outcome.result) : null;
}

/**
 * Resolve one address into the facts the drift engine needs.
 *
 * Seven calls, paced: source code, creation, four proxy slots, upgrade logs.
 * Every one of them fails soft — a failed call adds a warning and leaves its
 * field null, because a half-resolved deployment is still worth recording and
 * an aborted run over 900 protocols is not.
 *
 * Throws only for an address this module cannot address at all: a non-EVM
 * chain or a malformed address, both of which are caller bugs rather than
 * network weather.
 */
export async function resolveDeployment(
  chain: string,
  rawAddress: string,
  options: ExplorerOptions,
): Promise<ResolvedDeployment> {
  const chainId = EXPLORER_CHAIN_IDS[chain];
  if (chainId === undefined) {
    throw new Error(
      `${chain} has no block-explorer support; pin its contracts by hand ` +
        `(supported: ${SUPPORTED_CHAINS.join(", ")})`,
    );
  }

  const address = normalizeAddress(rawAddress);
  if (!isEvmAddress(address)) {
    throw new Error(`${rawAddress} is not a 20-byte EVM address`);
  }

  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const warnings: string[] = [];

  const sourceOutcome = await call(
    chainId,
    { module: "contract", action: "getsourcecode", address },
    options,
  );
  if (sourceOutcome.kind === "error") {
    warnings.push(`source lookup failed: ${sourceOutcome.message}`);
  }
  const source =
    sourceOutcome.kind === "ok"
      ? readSourceCode(sourceOutcome.result)
      : {
          contractName: null,
          sourceVerified: false,
          explorerSaysProxy: false,
          implementation: null,
        };

  await sleep(throttleMs);
  const creationOutcome = await call(
    chainId,
    { module: "contract", action: "getcontractcreation", contractaddresses: address },
    options,
  );
  if (creationOutcome.kind === "error") {
    warnings.push(`creation lookup failed: ${creationOutcome.message}`);
  }
  const creation =
    creationOutcome.kind === "ok" ? readCreation(creationOutcome.result) : null;

  // Older responses omit the creation timestamp; recover it from the block.
  let deployedAt = creation?.deployedAt ?? null;
  const creationBlock = creation?.blockNumber ?? null;
  if (deployedAt === null && creationBlock !== null) {
    await sleep(throttleMs);
    const blockOutcome = await call(
      chainId,
      {
        module: "proxy",
        action: "eth_getBlockByNumber",
        tag: `0x${creationBlock.toString(16)}`,
        boolean: "false",
      },
      options,
    );
    if (blockOutcome.kind === "ok" && blockOutcome.result !== null) {
      const block = blockOutcome.result as Record<string, unknown>;
      deployedAt = parseUnixSeconds(block.timestamp);
    }
  }

  const probe: ProxyProbe = {
    eip1967Implementation: null,
    eip1967Admin: null,
    eip1967Beacon: null,
    zeppelinosImplementation: null,
  };
  for (const [key, slot] of [
    ["eip1967Implementation", PROXY_SLOTS.eip1967Implementation],
    ["eip1967Admin", PROXY_SLOTS.eip1967Admin],
    ["eip1967Beacon", PROXY_SLOTS.eip1967Beacon],
    ["zeppelinosImplementation", PROXY_SLOTS.zeppelinosImplementation],
  ] as const) {
    await sleep(throttleMs);
    probe[key] = await readSlot(chainId, address, slot, options);
  }

  const proxy = deriveProxy(probe, source.explorerSaysProxy);

  await sleep(throttleMs);
  const logsOutcome = await call(
    chainId,
    {
      module: "logs",
      action: "getLogs",
      address,
      topic0: UPGRADED_TOPIC0,
      fromBlock: "0",
      toBlock: "latest",
    },
    options,
  );
  if (logsOutcome.kind === "error") {
    warnings.push(`upgrade-log lookup failed: ${logsOutcome.message}`);
  }
  const upgrades =
    logsOutcome.kind === "ok" ? readUpgradeLogs(logsOutcome.result) : [];

  return {
    chain,
    address,
    contractName: source.contractName,
    sourceVerified: source.sourceVerified,
    isUpgradeable: proxy.isUpgradeable,
    // A storage read beats the explorer's recorded implementation; fall back
    // to the explorer's only when the slots said nothing.
    implementation: proxy.implementation ?? source.implementation,
    upgradeAuthority: proxy.upgradeAuthority,
    proxyKind: proxy.kind,
    deployedAt,
    creationTxHash: creation?.txHash ?? null,
    creator: creation?.creator ?? null,
    lastUpgradedAt: lastUpgradedAt(upgrades),
    upgrades,
    explorerUrl: explorerAddressUrl(chain, address),
    warnings,
  };
}
