import { describe, expect, it } from "vitest";

import { computePriority, type PriorityInput } from "./priority";

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
