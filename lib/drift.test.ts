import { describe, expect, it } from "vitest";

import { computeDrift, type CandidateAudit } from "./drift";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// A covering audit: reviewed an ancestor of the deployed commit, dated cleanly.
const coveringAudit = (reportDate: string): CandidateAudit => ({
  reviewedCommit: "aaaa111",
  reportDate: day(reportDate),
  isAncestorOfDeployed: true,
});

describe("computeDrift", () => {
  describe("current (covered, no upgrade since audit)", () => {
    it("returns current with 0 drift when there is no upgrade after the audit", () => {
      const result = computeDrift({
        deployedCommit: "bbbb222",
        lastUpgradedAt: null,
        deployedAt: day("2024-01-01"),
        candidateAudits: [coveringAudit("2024-06-01")],
        now: day("2025-01-01"),
      });
      expect(result).toEqual({ coverageState: "current", driftDays: 0 });
    });

    it("treats an upgrade on/before the report date as current", () => {
      const result = computeDrift({
        deployedCommit: "bbbb222",
        lastUpgradedAt: day("2024-06-01"),
        deployedAt: day("2024-01-01"),
        candidateAudits: [coveringAudit("2024-06-01")],
        now: day("2025-01-01"),
      });
      expect(result).toEqual({ coverageState: "current", driftDays: 0 });
    });
  });

  describe("drifted (upgrade after the covering audit)", () => {
    it("measures drift_days from the covering audit's report date to the last upgrade", () => {
      const result = computeDrift({
        deployedCommit: "bbbb222",
        lastUpgradedAt: day("2024-07-01"),
        deployedAt: day("2024-01-01"),
        candidateAudits: [coveringAudit("2024-06-01")],
        now: day("2025-01-01"),
      });
      // June 1 -> July 1 = 30 days
      expect(result).toEqual({ coverageState: "drifted", driftDays: 30 });
    });

    it("uses the MOST RECENT ancestor audit as the covering audit", () => {
      const result = computeDrift({
        deployedCommit: "bbbb222",
        lastUpgradedAt: day("2024-12-31"),
        deployedAt: day("2024-01-01"),
        candidateAudits: [
          coveringAudit("2024-01-15"),
          coveringAudit("2024-06-01"), // newest -> this one wins
          coveringAudit("2024-03-01"),
        ],
        now: day("2025-06-01"),
      });
      // from 2024-06-01 to 2024-12-31 = 213 days
      expect(result).toEqual({ coverageState: "drifted", driftDays: 213 });
    });

    it("ignores audits that are not ancestors of the deployed commit", () => {
      const result = computeDrift({
        deployedCommit: "bbbb222",
        lastUpgradedAt: day("2024-07-01"),
        deployedAt: day("2024-01-01"),
        candidateAudits: [
          { reviewedCommit: "zzzz999", reportDate: day("2024-12-01"), isAncestorOfDeployed: false },
          coveringAudit("2024-06-01"),
        ],
        now: day("2025-01-01"),
      });
      // The non-ancestor Dec audit is ignored; June audit covers -> 30 days.
      expect(result).toEqual({ coverageState: "drifted", driftDays: 30 });
    });
  });

  describe("uncovered (no audit covers the deployed commit)", () => {
    it("returns uncovered measured from the deployment date when no audits exist", () => {
      const result = computeDrift({
        deployedCommit: "bbbb222",
        lastUpgradedAt: day("2024-07-01"),
        deployedAt: day("2024-01-01"),
        candidateAudits: [],
        now: day("2024-01-31"),
      });
      // deployedAt 2024-01-01 -> now 2024-01-31 = 30 days
      expect(result).toEqual({ coverageState: "uncovered", driftDays: 30 });
    });

    it("is uncovered when audits exist but none are ancestors of the deployed commit", () => {
      const result = computeDrift({
        deployedCommit: "bbbb222",
        lastUpgradedAt: day("2024-07-01"),
        deployedAt: day("2024-01-01"),
        candidateAudits: [
          { reviewedCommit: "zzzz999", reportDate: day("2024-05-01"), isAncestorOfDeployed: false },
        ],
        now: day("2024-01-31"),
      });
      expect(result).toEqual({ coverageState: "uncovered", driftDays: 30 });
    });

    it("returns null drift_days for an uncovered deployment with no deployment date", () => {
      const result = computeDrift({
        deployedCommit: "bbbb222",
        lastUpgradedAt: null,
        deployedAt: null,
        candidateAudits: [],
        now: day("2024-01-31"),
      });
      expect(result).toEqual({ coverageState: "uncovered", driftDays: null });
    });
  });

  describe("unknown (missing commit data on either side)", () => {
    it("is unknown when the deployed commit is missing", () => {
      const result = computeDrift({
        deployedCommit: null,
        lastUpgradedAt: day("2024-07-01"),
        deployedAt: day("2024-01-01"),
        candidateAudits: [coveringAudit("2024-06-01")],
        now: day("2025-01-01"),
      });
      expect(result).toEqual({ coverageState: "unknown", driftDays: null });
    });

    it("is unknown when a covering audit has no reviewed commit", () => {
      const result = computeDrift({
        deployedCommit: "bbbb222",
        lastUpgradedAt: day("2024-07-01"),
        deployedAt: day("2024-01-01"),
        candidateAudits: [
          { reviewedCommit: null, reportDate: day("2024-06-01"), isAncestorOfDeployed: true },
        ],
        now: day("2025-01-01"),
      });
      expect(result).toEqual({ coverageState: "unknown", driftDays: null });
    });

    it("is unknown when a covering audit has no report date", () => {
      const result = computeDrift({
        deployedCommit: "bbbb222",
        lastUpgradedAt: day("2024-07-01"),
        deployedAt: day("2024-01-01"),
        candidateAudits: [
          { reviewedCommit: "aaaa111", reportDate: null, isAncestorOfDeployed: true },
        ],
        now: day("2025-01-01"),
      });
      expect(result).toEqual({ coverageState: "unknown", driftDays: null });
    });
  });

  describe("day math", () => {
    it("never returns negative drift (clamped at 0)", () => {
      const result = computeDrift({
        deployedCommit: "bbbb222",
        lastUpgradedAt: day("2024-05-01"), // before the report date
        deployedAt: day("2024-01-01"),
        candidateAudits: [coveringAudit("2024-06-01")],
        now: day("2025-01-01"),
      });
      // upgrade predates the audit -> treated as current, not negative drift
      expect(result).toEqual({ coverageState: "current", driftDays: 0 });
    });
  });
});
