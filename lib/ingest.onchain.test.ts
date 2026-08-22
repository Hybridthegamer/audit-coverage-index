import { describe, expect, it } from "vitest";

import {
  buildScopeNote,
  GITHUB_AUDITOR_UNKNOWN,
  isCommitSha,
  planDeploymentWrite,
  planDiscoveredAudits,
  planUpgradeRows,
  upgradeDedupKey,
  type ExistingDeployment,
} from "./ingest.onchain";
import type { ResolvedDeployment, ResolvedUpgrade } from "./sources/explorer";
import type { DiscoveredReport } from "./sources/github";

/* ═══════════════════════════════════════════════════════════════════════════
   The pure half of the step-7 write path. Same job the step-6 planners do in
   ingest.test.ts: prove that a re-run writes nothing new, and that nothing a
   researcher recorded by hand can be destroyed by a machine that knows less.
   ═══════════════════════════════════════════════════════════════════════════ */

const existing = (over: Partial<ExistingDeployment> = {}): ExistingDeployment => ({
  label: null,
  isUpgradeable: false,
  upgradeAuthority: null,
  deployedAt: null,
  lastUpgradedAt: null,
  sourceVerified: false,
  explorerUrl: null,
  ...over,
});

const resolved = (over: Partial<ResolvedDeployment> = {}): ResolvedDeployment => ({
  chain: "base",
  address: "0xaaaabbbbccccddddeeeeffff0000111122223333",
  contractName: "TransparentUpgradeableProxy",
  sourceVerified: true,
  isUpgradeable: true,
  implementation: "0x1111111111111111111111111111111111111111",
  upgradeAuthority: "0x2222222222222222222222222222222222222222",
  proxyKind: "eip1967",
  deployedAt: new Date("2023-04-01T00:00:00.000Z"),
  creationTxHash: null,
  creator: null,
  lastUpgradedAt: new Date("2025-02-02T00:00:00.000Z"),
  upgrades: [],
  explorerUrl: "https://basescan.org/address/0xaaaa",
  warnings: [],
  ...over,
});

const upgrade = (over: Partial<ResolvedUpgrade> = {}): ResolvedUpgrade => ({
  occurredAt: new Date("2025-02-02T00:00:00.000Z"),
  txHash: `0x${"11".repeat(32)}`,
  newImplementation: "0x1111111111111111111111111111111111111111",
  blockNumber: 100,
  ...over,
});

describe("planDeploymentWrite", () => {
  it("fills an empty row from the explorer", () => {
    const plan = planDeploymentWrite(existing(), resolved());
    expect(plan.changed).toBe(true);
    expect(plan.values).toEqual({
      label: "TransparentUpgradeableProxy",
      isUpgradeable: true,
      upgradeAuthority: "0x2222222222222222222222222222222222222222",
      deployedAt: new Date("2023-04-01T00:00:00.000Z"),
      lastUpgradedAt: new Date("2025-02-02T00:00:00.000Z"),
      sourceVerified: true,
      explorerUrl: "https://basescan.org/address/0xaaaa",
    });
  });

  it("writes nothing on a re-run — the idempotency property", () => {
    const first = planDeploymentWrite(existing(), resolved());
    const second = planDeploymentWrite(first.values, resolved());
    expect(second.changed).toBe(false);
  });

  it("never lets a null from the explorer erase a recorded value", () => {
    // "Not established" is weaker than a researcher's hand-entered date.
    const plan = planDeploymentWrite(
      existing({
        deployedAt: new Date("2021-06-06T00:00:00.000Z"),
        upgradeAuthority: "0x9999999999999999999999999999999999999999",
        explorerUrl: "https://basescan.org/address/0xaaaa",
      }),
      resolved({ deployedAt: null, upgradeAuthority: null, explorerUrl: null }),
    );
    expect(plan.values.deployedAt).toEqual(new Date("2021-06-06T00:00:00.000Z"));
    expect(plan.values.upgradeAuthority).toBe(
      "0x9999999999999999999999999999999999999999",
    );
    expect(plan.values.explorerUrl).toBe("https://basescan.org/address/0xaaaa");
  });

  it("keeps a researcher's label over the explorer's contract name", () => {
    const plan = planDeploymentWrite(existing({ label: "v3 Pool (main)" }), resolved());
    expect(plan.values.label).toBe("v3 Pool (main)");
  });

  it("lets the booleans move in both directions — a completed probe is a finding", () => {
    const plan = planDeploymentWrite(
      existing({ isUpgradeable: true, sourceVerified: true }),
      resolved({ isUpgradeable: false, sourceVerified: false }),
    );
    expect(plan.changed).toBe(true);
    expect(plan.values.isUpgradeable).toBe(false);
    expect(plan.values.sourceVerified).toBe(false);
  });

  it("has no deployed_commit to write — it is not in the value type", () => {
    const plan = planDeploymentWrite(existing(), resolved());
    expect(plan.values).not.toHaveProperty("deployedCommit");
  });
});

describe("upgrade events", () => {
  it("keys on the transaction hash", () => {
    expect(upgradeDedupKey(`0x${"AB".repeat(32)}`, new Date(0))).toBe(
      `0x${"ab".repeat(32)}`,
    );
  });

  it("falls back to the timestamp when a log carries no hash", () => {
    expect(upgradeDedupKey(null, new Date(1_700_000_000_000))).toBe("t:1700000000000");
  });

  it("writes each upgrade once, however many times the sweep runs", () => {
    const upgrades = [
      upgrade({ txHash: `0x${"11".repeat(32)}` }),
      upgrade({ txHash: `0x${"22".repeat(32)}` }),
    ];
    const first = planUpgradeRows(upgrades, new Set(), 200);
    expect(first).toHaveLength(2);

    const recorded = new Set(first.map((u) => upgradeDedupKey(u.txHash, u.occurredAt)));
    expect(planUpgradeRows(upgrades, recorded, 200)).toHaveLength(0);
  });

  it("keeps the NEWEST events when the cap bites", () => {
    const upgrades = [
      upgrade({ txHash: `0x${"11".repeat(32)}`, occurredAt: new Date(1_000) }),
      upgrade({ txHash: `0x${"22".repeat(32)}`, occurredAt: new Date(2_000) }),
      upgrade({ txHash: `0x${"33".repeat(32)}`, occurredAt: new Date(3_000) }),
    ];
    const planned = planUpgradeRows(upgrades, new Set(), 2);
    expect(planned.map((u) => u.occurredAt.getTime())).toEqual([2_000, 3_000]);
  });
});

describe("planDiscoveredAudits", () => {
  const report = (over: Partial<DiscoveredReport> = {}): DiscoveredReport => ({
    auditor: "Trail of Bits",
    reportUrl: "https://github.com/x/y/blob/HEAD/audits/2023-05-12-tob.pdf",
    path: "audits/2023-05-12-tob.pdf",
    reportDate: new Date("2023-05-12T00:00:00.000Z"),
    candidateCommit: "abcdef1234567890",
    candidateCommitDate: new Date("2023-05-20T00:00:00.000Z"),
    ...over,
  });

  it("plans one row per new report", () => {
    const rows = planDiscoveredAudits([report()], "audits", new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.auditor).toBe("Trail of Bits");
    expect(rows[0]?.reportDate).toEqual(new Date("2023-05-12T00:00:00.000Z"));
  });

  it("skips a report URL already on record — dedup across sources", () => {
    const existingUrls = new Set([report().reportUrl]);
    expect(planDiscoveredAudits([report()], "audits", existingUrls)).toHaveLength(0);
  });

  it("does not write the same URL twice within one run", () => {
    expect(planDiscoveredAudits([report(), report()], "audits", new Set())).toHaveLength(1);
  });

  it("labels an unattributable report rather than guessing a firm", () => {
    const rows = planDiscoveredAudits([report({ auditor: null })], "audits", new Set());
    expect(rows[0]?.auditor).toBe(GITHUB_AUDITOR_UNKNOWN);
  });

  it("carries a null report date through as null", () => {
    const rows = planDiscoveredAudits([report({ reportDate: null })], "audits", new Set());
    expect(rows[0]?.reportDate).toBeNull();
  });
});

describe("buildScopeNote", () => {
  const report: DiscoveredReport = {
    auditor: "Zellic",
    reportUrl: "https://github.com/x/y/blob/HEAD/audits/zellic.pdf",
    path: "audits/zellic.pdf",
    reportDate: null,
    candidateCommit: "abcdef1234567890fedcba",
    candidateCommitDate: new Date("2024-02-09T00:00:00.000Z"),
  };

  it("records the candidate commit as prose, never as a value", () => {
    const note = buildScopeNote(report, "audits");
    expect(note).toContain("CANDIDATE reviewed commit abcdef123456");
    expect(note).toContain("Not written to reviewed_commit");
  });

  it("explains a null report date and offers the commit date as a candidate", () => {
    const note = buildScopeNote(report, "audits");
    expect(note).toContain("states no report date");
    expect(note).toContain("landed in the repo on 2024-02-09");
  });

  it("says so when no commit could be resolved", () => {
    expect(
      buildScopeNote({ ...report, candidateCommit: null }, "audits"),
    ).toContain("No candidate commit resolved.");
  });
});

describe("isCommitSha", () => {
  it("accepts what git accepts — abbreviated or full", () => {
    expect(isCommitSha("abcdef1")).toBe(true);
    expect(isCommitSha("a".repeat(40))).toBe(true);
    expect(isCommitSha("  ABCDEF1  ")).toBe(true);
  });

  it("rejects anything else, so a branch name can never become a commit", () => {
    expect(isCommitSha("main")).toBe(false);
    expect(isCommitSha("abc")).toBe(false);
    expect(isCommitSha("a".repeat(41))).toBe(false);
    expect(isCommitSha("v1.2.3")).toBe(false);
  });
});
