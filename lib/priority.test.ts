import { describe, expect, it } from "vitest";

import {
  computePriority,
  computeProtocolPriority,
  type PriorityInput,
} from "./priority";

const base: PriorityInput = {
  coverageState: "current",
  tvlUsd: null,
  driftDays: null,
  hasBounty: false,
  isUpgradeable: false,
};

describe("computePriority", () => {
  it("scores a covered, unremarkable deployment at zero", () => {
    expect(computePriority(base)).toBe(0);
  });

  it("ranks the four coverage states uncovered > drifted > unknown > current", () => {
    const score = (coverageState: PriorityInput["coverageState"]) =>
      computePriority({ ...base, coverageState });
    expect(score("uncovered")).toBeGreaterThan(score("drifted"));
    expect(score("drifted")).toBeGreaterThan(score("unknown"));
    expect(score("unknown")).toBeGreaterThan(score("current"));
  });

  it("adds log-scaled TVL points, capped at ~$1B", () => {
    const at = (tvlUsd: number) => computePriority({ ...base, tvlUsd });
    expect(at(1_000)).toBe(0); // floor
    expect(at(1_000_000_000)).toBe(30); // full 30 points
    expect(at(10_000_000_000)).toBe(30); // clamped, a whale can't exceed it
    expect(at(1_000_000)).toBeGreaterThan(at(1_000)); // monotonic
    expect(at(1_000_000_000)).toBeGreaterThan(at(1_000_000));
  });

  it("treats null and non-positive TVL/drift as zero contribution", () => {
    expect(computePriority({ ...base, tvlUsd: null, driftDays: null })).toBe(0);
    expect(computePriority({ ...base, tvlUsd: 0, driftDays: 0 })).toBe(0);
    expect(computePriority({ ...base, tvlUsd: -5, driftDays: -5 })).toBe(0);
  });

  it("adds drift points up to a one-year cap", () => {
    const at = (driftDays: number) => computePriority({ ...base, driftDays });
    expect(at(365)).toBe(20);
    expect(at(3650)).toBe(20); // clamped
    expect(at(183)).toBeGreaterThan(0);
    expect(at(183)).toBeLessThan(20);
  });

  it("adds a bounty bonus and an upgradeable bonus", () => {
    expect(computePriority({ ...base, hasBounty: true })).toBe(8);
    expect(computePriority({ ...base, isUpgradeable: true })).toBe(5);
    expect(
      computePriority({ ...base, hasBounty: true, isUpgradeable: true }),
    ).toBe(13);
  });

  it("puts a whale of uncovered code with a bounty near the top of the range", () => {
    const score = computePriority({
      coverageState: "uncovered",
      tvlUsd: 5_000_000_000,
      driftDays: 500,
      hasBounty: true,
      isUpgradeable: true,
    });
    // 50 + 30 + 20 + 8 + 5 = 113
    expect(score).toBe(113);
  });
});

/* ── Protocol-level priority (build step 6) ──────────────────────────────
   The ranking for sourced protocols that have no deployments pinned yet, so
   none of computePriority's inputs exist. Separate formula, separate range. */

describe("computeProtocolPriority", () => {
  it("ranks an unaudited protocol above an identical audited one", () => {
    const unaudited = computeProtocolPriority({
      auditStatus: "unaudited",
      tvlUsd: 50_000_000,
      hasBounty: false,
    });
    const audited = computeProtocolPriority({
      auditStatus: "audited",
      tvlUsd: 50_000_000,
      hasBounty: false,
    });
    expect(unaudited).toBeGreaterThan(audited);
    expect(unaudited - audited).toBe(30); // the audit base gap, 40 vs 10
  });

  it("weighs money on the same log curve as the deployment formula", () => {
    // Both formulas award the identical 0..30 tvlComponent, so a protocol and
    // a deployment holding the same money are ranked by the same money term.
    const protocolTvlTerm =
      computeProtocolPriority({
        auditStatus: "audited",
        tvlUsd: 1_000_000_000,
        hasBounty: false,
      }) - 10;
    const deploymentTvlTerm = computePriority({
      coverageState: "current",
      tvlUsd: 1_000_000_000,
      driftDays: null,
      hasBounty: false,
      isUpgradeable: false,
    });
    expect(protocolTvlTerm).toBe(30);
    expect(deploymentTvlTerm).toBe(30);
  });

  it("scores an unknown TVL as zero money rather than guessing", () => {
    expect(
      computeProtocolPriority({
        auditStatus: "audited",
        tvlUsd: null,
        hasBounty: false,
      }),
    ).toBe(10);
  });

  it("tops out at 78 — an unaudited billion-dollar protocol with a bounty", () => {
    expect(
      computeProtocolPriority({
        auditStatus: "unaudited",
        tvlUsd: 5_000_000_000,
        hasBounty: true,
      }),
    ).toBe(78); // 40 + 30 + 8
  });
});
