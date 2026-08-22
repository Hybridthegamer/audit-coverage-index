import { describe, expect, it } from "vitest";

import {
  DEFAULT_RESEARCHER,
  renderFixVerification,
  renderFullReport,
  renderInitialContact,
  renderSubmission,
  type SubmissionContext,
} from "./submission";

/* ═══════════════════════════════════════════════════════════════════════════
   The generator's three rules (see the module header) are the things worth
   testing: no PoC code can ever reach the output, missing data is loud rather
   than blank, and nothing is inflated. The prose is not tested; the guarantees
   are.
   ═══════════════════════════════════════════════════════════════════════════ */

const NOW = new Date("2026-08-22T12:00:00.000Z");

const context = (over: Partial<SubmissionContext> = {}): SubmissionContext => ({
  protocolName: "Vaultward",
  securityContact: "security@vaultward.xyz",
  website: "https://vaultward.xyz",
  githubRepo: "https://github.com/vaultward/contracts",
  hasBounty: false,
  bountyPlatform: "none",
  bountyUrl: null,

  chain: "base",
  addressOrProgramId: "0xaaaabbbbccccddddeeeeffff0000111122223333",
  deploymentLabel: "Vault (v2)",
  deployedCommit: "abcdef1234567890abcdef1234567890abcdef12",
  explorerUrl: "https://basescan.org/address/0xaaaa",
  coverageState: "drifted",
  driftDays: 214,

  title: "Rounding in convertToAssets lets a depositor drain share dust",
  severity: "High",
  immunefiClass: "Direct theft of user funds",
  fundsAtRiskUsd: 1_240_000,
  summary: "Repeated small withdrawals round in the caller's favour.",
  rootCause: "convertToAssets rounds up instead of down.",
  attackPath: "1. Deposit 1e18\n2. Withdraw(1) N times",
  preconditions: "Attacker needs 1e18 of TOKEN and gas.",
  impact: "At 50,000 iterations the attacker extracts $1.24M.",
  recommendedFix: "Use mulDiv with Math.Rounding.Down.",
  pocRef: "https://github.com/hybrid/poc-vaultward",
  inPostAuditCode: true,

  coveringAudit: {
    auditor: "Trail of Bits",
    reportDate: new Date("2025-01-20T00:00:00.000Z"),
    reviewedCommit: "1111111111111111111111111111111111111111",
    reportUrl: "https://example.com/report.pdf",
  },
  firstContactAt: new Date("2026-08-01T09:00:00.000Z"),
  now: NOW,
  ...over,
});

describe("renderInitialContact", () => {
  it("opens a channel and asks the three questions, with no technical detail", () => {
    const text = renderInitialContact(context());
    expect(text).toContain("Subject: Security disclosure — Vaultward Vault (v2)");
    expect(text).toContain("Is there a disclosure policy or bug bounty");
    expect(text).toContain("safe harbour");
    expect(text).toContain("90 days by default");
    expect(text).toContain(DEFAULT_RESEARCHER.github);

    // The bug itself must not leak into the first email.
    expect(text).not.toContain("convertToAssets");
    expect(text).not.toContain("Attack path");
  });

  it("uses the recorded severity verbatim and never picks one", () => {
    expect(renderInitialContact(context({ severity: "Medium" }))).toContain(
      "a medium-severity issue",
    );
    expect(renderInitialContact(context({ severity: null }))).toContain("[todo:");
  });

  it("addresses the team when no security contact is recorded", () => {
    expect(renderInitialContact(context({ securityContact: null }))).toContain(
      "Hi Vaultward team,",
    );
  });
});

describe("renderFullReport", () => {
  it("fills every section from the recorded finding", () => {
    const { markdown, missing } = renderFullReport(context());
    expect(missing).toEqual([]);
    expect(markdown).toContain("# [High] — Rounding in convertToAssets");
    expect(markdown).toContain("**Immunefi classification:** Direct theft of user funds");
    expect(markdown).toContain("## Attack path");
    expect(markdown).toContain("Use mulDiv with Math.Rounding.Down.");
  });

  it("states funds at risk exactly, not compacted", () => {
    // A triager checks the figure; "$1.2M" is not a figure.
    expect(renderFullReport(context()).markdown).toContain("$1,240,000");
  });

  it("builds the scope table with both commits and the coverage verdict", () => {
    const { markdown } = renderFullReport(context());
    expect(markdown).toContain("| Deployed commit | `abcdef123456` |");
    expect(markdown).toContain("Trail of Bits, 2025-01-20");
    expect(markdown).toContain("| Coverage state | Drifted |");
  });

  it("makes the post-audit claim only when the finding actually carries it", () => {
    expect(renderFullReport(context()).markdown).toContain(
      "**This bug is in code that shipped after your last audit.**",
    );
    expect(renderFullReport(context()).markdown).toContain("214 days ahead");

    const before = renderFullReport(context({ inPostAuditCode: false }));
    expect(before.markdown).not.toContain("shipped after your last audit");
  });

  it("says so plainly when no audit covers the deployment at all", () => {
    const { markdown } = renderFullReport(
      context({ coveringAudit: null, coverageState: "uncovered" }),
    );
    expect(markdown).toContain("no audit on record covers this deployment");
    expect(markdown).toContain("There is no audit on record covering the deployed code");
  });

  it("renders the PoC POINTER and never anything runnable", () => {
    const { markdown } = renderFullReport(context());
    expect(markdown).toContain("Proof of concept: `https://github.com/hybrid/poc-vaultward`");
    expect(markdown).toContain("never the exploit itself");
    // The hard constraint, asserted: there is no code fence in the PoC section.
    const poc = markdown.slice(markdown.indexOf("## Proof of concept"));
    expect(poc.slice(0, poc.indexOf("## Impact"))).not.toContain("```");
  });

  it("computes the 90-day window from first contact", () => {
    const { markdown } = renderFullReport(context());
    expect(markdown).toContain("- Reported 2026-08-01");
    expect(markdown).toContain("90-day disclosure window from first contact — 2026-10-30");
  });

  it("falls back to today and says the contact is not logged", () => {
    const { markdown } = renderFullReport(context({ firstContactAt: null }));
    expect(markdown).toContain("- Reported 2026-08-22 (first contact not yet logged)");
  });

  it("points at the bounty programme when there is one", () => {
    const { markdown } = renderFullReport(
      context({
        hasBounty: true,
        bountyPlatform: "immunefi",
        bountyUrl: "https://immunefi.com/bounty/vaultward",
      }),
    );
    expect(markdown).toContain("Submitting through immunefi");
  });
});

describe("missing data is loud, never blank", () => {
  it("marks every unfilled field and reports them", () => {
    const { markdown, missing } = renderFullReport(
      context({
        severity: null,
        summary: null,
        rootCause: null,
        attackPath: null,
        impact: null,
        recommendedFix: null,
        preconditions: null,
        pocRef: null,
        fundsAtRiskUsd: null,
        immunefiClass: null,
        deployedCommit: null,
      }),
    );

    expect(markdown).toContain("[TODO:");
    expect(markdown).toContain("[TODO: pin the deployed commit]");
    expect(missing).toContain("severity (Critical / High / Medium / Low)");
    expect(missing).toContain("funds at risk");
    expect(missing).toContain("proof of concept (poc_ref)");
    expect(missing).toContain("Immunefi classification");
    expect(missing.length).toBeGreaterThanOrEqual(9);
  });

  it("treats whitespace as missing — a space is not a summary", () => {
    const { missing } = renderFullReport(context({ summary: "   " }));
    expect(missing.some((m) => m.startsWith("summary"))).toBe(true);
  });
});

describe("renderFixVerification", () => {
  it("names the finding and leaves the verdict to the researcher", () => {
    const text = renderFixVerification(context());
    expect(text).toContain("Rounding in convertToAssets");
    expect(text).toContain("[TODO: fix commit]");
    expect(text).toContain("writeup");
  });
});

describe("renderSubmission", () => {
  it("returns all three artefacts and a de-duplicated missing list", () => {
    const artefacts = renderSubmission(context({ severity: null }));
    expect(artefacts.initialContact.length).toBeGreaterThan(0);
    expect(artefacts.fullReport.length).toBeGreaterThan(0);
    expect(artefacts.fixVerification.length).toBeGreaterThan(0);
    expect(
      artefacts.missing.filter((m) => m.startsWith("severity")),
    ).toHaveLength(1);
  });
});
