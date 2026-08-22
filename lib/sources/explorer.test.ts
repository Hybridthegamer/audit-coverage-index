import { describe, expect, it } from "vitest";

import {
  addressFromStorageWord,
  deriveProxy,
  explorerAddressUrl,
  isEvmAddress,
  isSupportedChain,
  lastUpgradedAt,
  normalizeAddress,
  parseNumeric,
  parseUnixSeconds,
  readCreation,
  readEnvelope,
  readSourceCode,
  readUpgradeLogs,
  ZERO_ADDRESS,
  type ProxyProbe,
} from "./explorer";
import { explorerConfigFromEnv } from "./explorer.config";

/* ═══════════════════════════════════════════════════════════════════════════
   The explorer's response shapes are as hostile as the DefiLlama feed's, and
   the failure modes are worse: a misread here writes a wrong deployment date
   or a wrong last_upgraded_at, both of which feed computeDrift and end up on
   a public page as an assertion about somebody's money. Every decode step is
   pinned against a fixture.
   ═══════════════════════════════════════════════════════════════════════════ */

const IMPL = "0x1111111111111111111111111111111111111111";
const ADMIN = "0x2222222222222222222222222222222222222222";
const BEACON = "0x3333333333333333333333333333333333333333";

const word = (address: string) => `0x${"0".repeat(24)}${address.slice(2)}`;

const emptyProbe = (): ProxyProbe => ({
  eip1967Implementation: null,
  eip1967Admin: null,
  eip1967Beacon: null,
  zeppelinosImplementation: null,
});

describe("chain support", () => {
  it("covers the EVM members of the chain enum and nothing else", () => {
    expect(isSupportedChain("ethereum")).toBe(true);
    expect(isSupportedChain("base")).toBe(true);
    expect(isSupportedChain("arbitrum")).toBe(true);
    // Non-EVM chains are reported as unsupported, never silently skipped.
    expect(isSupportedChain("solana")).toBe(false);
    expect(isSupportedChain("stacks")).toBe(false);
  });

  it("builds a per-chain explorer URL, or null when it cannot", () => {
    expect(explorerAddressUrl("base", IMPL)).toBe(`https://basescan.org/address/${IMPL}`);
    expect(explorerAddressUrl("solana", IMPL)).toBeNull();
  });
});

describe("addresses", () => {
  it("lowercases so a checksummed paste and a lowercase one are one row", () => {
    expect(normalizeAddress("  0xAbCdEf0123456789012345678901234567890123 ")).toBe(
      "0xabcdef0123456789012345678901234567890123",
    );
  });

  it("accepts only 20-byte hex", () => {
    expect(isEvmAddress(IMPL)).toBe(true);
    expect(isEvmAddress("0x123")).toBe(false);
    expect(isEvmAddress("not-an-address")).toBe(false);
  });
});

describe("addressFromStorageWord", () => {
  it("takes the low 20 bytes of a 32-byte word", () => {
    expect(addressFromStorageWord(word(IMPL))).toBe(IMPL);
  });

  it("reads an empty slot as 'not a proxy', not as the zero address", () => {
    expect(addressFromStorageWord(`0x${"0".repeat(64)}`)).toBeNull();
    expect(addressFromStorageWord("0x0")).toBeNull();
    expect(addressFromStorageWord(word(ZERO_ADDRESS))).toBeNull();
  });

  it("rejects malformed words rather than inventing an address", () => {
    expect(addressFromStorageWord(undefined)).toBeNull();
    expect(addressFromStorageWord("0xnothex")).toBeNull();
    expect(addressFromStorageWord(42)).toBeNull();
  });
});

describe("readEnvelope", () => {
  it("unwraps a success", () => {
    expect(readEnvelope({ status: "1", message: "OK", result: [1, 2] })).toEqual({
      kind: "ok",
      result: [1, 2],
    });
  });

  it("separates 'no records found' from a real failure — the whole point", () => {
    // An unupgraded proxy. Must NOT be read as an error…
    expect(readEnvelope({ status: "0", message: "No records found", result: [] })).toEqual(
      { kind: "empty" },
    );
    // …and a throttle must NOT be read as 'never upgraded'.
    const throttled = readEnvelope({
      status: "0",
      message: "NOTOK",
      result: "Max rate limit reached",
    });
    expect(throttled.kind).toBe("error");
  });

  it("handles the JSON-RPC envelope the proxy module answers with", () => {
    expect(readEnvelope({ jsonrpc: "2.0", id: 1, result: "0x0" })).toEqual({
      kind: "ok",
      result: "0x0",
    });
    expect(
      readEnvelope({ jsonrpc: "2.0", id: 1, error: { message: "header not found" } }),
    ).toEqual({ kind: "error", message: "header not found" });
  });

  it("rejects a non-object payload", () => {
    expect(readEnvelope("<html>gateway timeout</html>").kind).toBe("error");
  });
});

describe("numeric parsing", () => {
  it("reads hex and decimal, because the API uses both", () => {
    expect(parseNumeric("0x10")).toBe(16);
    expect(parseNumeric("16")).toBe(16);
    expect(parseNumeric(16)).toBe(16);
    expect(parseNumeric("")).toBeNull();
    expect(parseNumeric(undefined)).toBeNull();
  });

  it("turns unix seconds into a Date and rejects the zero timestamp", () => {
    expect(parseUnixSeconds("1700000000")?.toISOString()).toBe(
      "2023-11-14T22:13:20.000Z",
    );
    expect(parseUnixSeconds("0x654321f0")).toBeInstanceOf(Date);
    expect(parseUnixSeconds("0")).toBeNull();
    expect(parseUnixSeconds("nonsense")).toBeNull();
  });
});

describe("readSourceCode", () => {
  it("reads a verified proxy", () => {
    expect(
      readSourceCode([
        {
          ContractName: "TransparentUpgradeableProxy",
          ABI: '[{"type":"function"}]',
          SourceCode: "contract Proxy {}",
          Proxy: "1",
          Implementation: IMPL.toUpperCase(),
        },
      ]),
    ).toEqual({
      contractName: "TransparentUpgradeableProxy",
      sourceVerified: true,
      explorerSaysProxy: true,
      implementation: IMPL,
    });
  });

  it("decides 'verified' on content — the unverified case is a 200", () => {
    const facts = readSourceCode([
      {
        ContractName: "",
        ABI: "Contract source code not verified",
        SourceCode: "",
        Proxy: "0",
      },
    ]);
    expect(facts.sourceVerified).toBe(false);
    expect(facts.contractName).toBeNull();
  });

  it("survives a shape it has never seen", () => {
    expect(readSourceCode(null).sourceVerified).toBe(false);
    expect(readSourceCode([]).sourceVerified).toBe(false);
  });
});

describe("readUpgradeLogs", () => {
  const log = (over: Record<string, unknown> = {}) => ({
    topics: [
      "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b",
      word(IMPL),
    ],
    timeStamp: "0x65000000",
    transactionHash: `0x${"ab".repeat(32)}`,
    blockNumber: "0x1234",
    ...over,
  });

  it("decodes the indexed implementation out of topics[1]", () => {
    const [upgrade] = readUpgradeLogs([log()]);
    expect(upgrade?.newImplementation).toBe(IMPL);
    expect(upgrade?.blockNumber).toBe(0x1234);
    expect(upgrade?.txHash).toBe(`0x${"ab".repeat(32)}`);
  });

  it("sorts oldest first so the timeline reads forward", () => {
    const upgrades = readUpgradeLogs([
      log({ timeStamp: "1700000000" }),
      log({ timeStamp: "1600000000" }),
      log({ timeStamp: "1650000000" }),
    ]);
    expect(upgrades.map((u) => u.occurredAt.getTime())).toEqual([
      1_600_000_000_000, 1_650_000_000_000, 1_700_000_000_000,
    ]);
  });

  it("drops an undatable log — upgrade_events.occurred_at is NOT NULL", () => {
    expect(readUpgradeLogs([log({ timeStamp: undefined })])).toHaveLength(0);
  });

  it("returns nothing for a non-array result", () => {
    expect(readUpgradeLogs("No records found")).toEqual([]);
  });
});

describe("readCreation", () => {
  it("reads creator, tx and timestamp when the response carries them", () => {
    expect(
      readCreation([
        {
          contractCreator: ADMIN.toUpperCase(),
          txHash: `0x${"cd".repeat(32)}`,
          blockNumber: "12345",
          timestamp: "1700000000",
        },
      ]),
    ).toEqual({
      creator: ADMIN,
      txHash: `0x${"cd".repeat(32)}`,
      blockNumber: 12345,
      deployedAt: new Date(1_700_000_000_000),
    });
  });

  it("leaves deployedAt null on older responses that omit it", () => {
    const facts = readCreation([
      { contractCreator: ADMIN, txHash: `0x${"cd".repeat(32)}`, blockNumber: "99" },
    ]);
    expect(facts?.deployedAt).toBeNull();
    expect(facts?.blockNumber).toBe(99);
  });

  it("returns null for an empty result", () => {
    expect(readCreation([])).toBeNull();
  });
});

describe("deriveProxy", () => {
  it("prefers EIP-1967 and records the admin as the upgrade authority", () => {
    expect(
      deriveProxy(
        { ...emptyProbe(), eip1967Implementation: IMPL, eip1967Admin: ADMIN },
        false,
      ),
    ).toEqual({
      isUpgradeable: true,
      implementation: IMPL,
      upgradeAuthority: ADMIN,
      kind: "eip1967",
    });
  });

  it("does not invent an implementation for a beacon proxy", () => {
    const verdict = deriveProxy({ ...emptyProbe(), eip1967Beacon: BEACON }, false);
    expect(verdict.isUpgradeable).toBe(true);
    expect(verdict.implementation).toBeNull();
    expect(verdict.kind).toBe("eip1967-beacon");
  });

  it("still catches pre-1967 zeppelinos proxies", () => {
    expect(
      deriveProxy({ ...emptyProbe(), zeppelinosImplementation: IMPL }, false).kind,
    ).toBe("zeppelinos");
  });

  it("trusts a storage read over the explorer's curation flag", () => {
    const verdict = deriveProxy({ ...emptyProbe(), eip1967Implementation: IMPL }, true);
    expect(verdict.kind).toBe("eip1967");
  });

  it("falls back to the explorer flag but records that it did", () => {
    expect(deriveProxy(emptyProbe(), true)).toEqual({
      isUpgradeable: true,
      implementation: null,
      upgradeAuthority: null,
      kind: "explorer-flag",
    });
  });

  it("calls an immutable contract immutable", () => {
    expect(deriveProxy(emptyProbe(), false)).toEqual({
      isUpgradeable: false,
      implementation: null,
      upgradeAuthority: null,
      kind: "none",
    });
  });
});

describe("lastUpgradedAt", () => {
  it("is the most recent upgrade", () => {
    expect(
      lastUpgradedAt([
        { occurredAt: new Date(1_000), txHash: null, newImplementation: null, blockNumber: null },
        { occurredAt: new Date(3_000), txHash: null, newImplementation: null, blockNumber: null },
        { occurredAt: new Date(2_000), txHash: null, newImplementation: null, blockNumber: null },
      ]),
    ).toEqual(new Date(3_000));
  });

  it("is null for a contract that never upgraded — a claim, not missing data", () => {
    expect(lastUpgradedAt([])).toBeNull();
  });
});

describe("explorerConfigFromEnv", () => {
  it("defaults everything and reports a missing key as null", () => {
    const config = explorerConfigFromEnv({});
    expect(config.apiKey).toBeNull();
    expect(config.throttleMs).toBe(250);
    expect(config.maxUpgrades).toBe(200);
  });

  it("reads the key and the knobs", () => {
    expect(
      explorerConfigFromEnv({
        ETHERSCAN_API_KEY: " ABC123 ",
        EXPLORER_THROTTLE_MS: "500",
        EXPLORER_MAX_UPGRADES: "50",
      }),
    ).toEqual({ apiKey: "ABC123", throttleMs: 500, maxUpgrades: 50 });
  });

  it("falls back rather than aborting on an unparseable value", () => {
    expect(explorerConfigFromEnv({ EXPLORER_THROTTLE_MS: "soon" }).throttleMs).toBe(250);
    expect(explorerConfigFromEnv({ ETHERSCAN_API_KEY: "   " }).apiKey).toBeNull();
  });
});
