import { describe, expect, it } from "vitest";

import {
  looksLikeReportFile,
  parseAuditor,
  parseGithubUrl,
  parseReportDate,
  rankCandidateRepos,
  type CandidateRepo,
} from "./github";
import { githubConfigFromEnv } from "./github.config";

/* ═══════════════════════════════════════════════════════════════════════════
   Discovery turns a filename into an auditor name and a report date, and the
   report date is an input to computeDrift. A sloppy parse here publishes a
   wrong coverage verdict, so the rule these tests enforce is: parse what the
   filename STATES, and return null the moment it stops stating it.
   ═══════════════════════════════════════════════════════════════════════════ */

describe("parseGithubUrl", () => {
  it("parses a repo URL", () => {
    expect(parseGithubUrl("https://github.com/aave/aave-v3-core")).toEqual({
      owner: "aave",
      repo: "aave-v3-core",
    });
  });

  it("parses the ORG page step 6 records, leaving the repo unpicked", () => {
    expect(parseGithubUrl("https://github.com/lidofinance")).toEqual({
      owner: "lidofinance",
      repo: null,
    });
  });

  it("tolerates a missing scheme, a trailing slash and a .git suffix", () => {
    expect(parseGithubUrl("github.com/foo/bar.git")).toEqual({
      owner: "foo",
      repo: "bar",
    });
    expect(parseGithubUrl("https://www.github.com/foo/bar/")).toEqual({
      owner: "foo",
      repo: "bar",
    });
  });

  it("ignores deep links past the repo", () => {
    expect(parseGithubUrl("https://github.com/foo/bar/tree/main/audits")).toEqual({
      owner: "foo",
      repo: "bar",
    });
  });

  it("rejects non-GitHub and empty values", () => {
    expect(parseGithubUrl("https://gitlab.com/foo/bar")).toBeNull();
    expect(parseGithubUrl(null)).toBeNull();
    expect(parseGithubUrl("   ")).toBeNull();
  });
});

describe("rankCandidateRepos", () => {
  const repo = (over: Partial<CandidateRepo> = {}): CandidateRepo => ({
    name: "misc",
    fork: false,
    archived: false,
    stars: 0,
    pushedAt: null,
    description: null,
    ...over,
  });

  it("puts the contracts repo above the frontend", () => {
    const ranked = rankCandidateRepos([
      repo({ name: "protocol-interface", stars: 900 }),
      repo({ name: "protocol-contracts", stars: 40 }),
      repo({ name: "docs" }),
    ]);
    expect(ranked[0]?.name).toBe("protocol-contracts");
  });

  it("drops forks and archives — neither is ever the live deployment", () => {
    const ranked = rankCandidateRepos([
      repo({ name: "core-contracts", fork: true }),
      repo({ name: "old-contracts", archived: true }),
      repo({ name: "core" }),
    ]);
    expect(ranked.map((r) => r.name)).toEqual(["core"]);
  });

  it("puts a repo literally named `audits` on top", () => {
    // Lido keeps every report in lidofinance/audits, not in the contracts repo.
    const ranked = rankCandidateRepos([
      repo({ name: "core", stars: 400 }),
      repo({ name: "lido-dao-contracts", stars: 800 }),
      repo({ name: "audits", stars: 12 }),
    ]);
    expect(ranked[0]?.name).toBe("audits");
  });

  it("lets stars break a tie without deciding the vote", () => {
    const ranked = rankCandidateRepos([
      repo({ name: "core", stars: 5 }),
      repo({ name: "core-v2", stars: 5_000 }),
    ]);
    expect(ranked[0]?.name).toBe("core-v2");
  });
});

describe("looksLikeReportFile", () => {
  it("accepts report documents", () => {
    expect(looksLikeReportFile("2023-05-12_TrailOfBits.pdf")).toBe(true);
    expect(looksLikeReportFile("summary.md")).toBe(true);
  });

  it("rejects source files and the folder's own README index", () => {
    expect(looksLikeReportFile("Vault.sol")).toBe(false);
    expect(looksLikeReportFile("README.md")).toBe(false);
    expect(looksLikeReportFile("readme.markdown")).toBe(false);
  });
});

describe("parseAuditor", () => {
  it("canonicalises a firm across separator styles", () => {
    expect(parseAuditor("audits/trail-of-bits-2023.pdf")).toBe("Trail of Bits");
    expect(parseAuditor("audits/TrailOfBits_Vault.pdf")).toBe("Trail of Bits");
    expect(parseAuditor("audits/trail_of_bits.pdf")).toBe("Trail of Bits");
  });

  it("recognises the firms these folders are actually full of", () => {
    expect(parseAuditor("audits/OpenZeppelin-final.pdf")).toBe("OpenZeppelin");
    expect(parseAuditor("audits/2022-09-chainsecurity.pdf")).toBe("ChainSecurity");
    expect(parseAuditor("audits/spearbit_review.pdf")).toBe("Spearbit");
    expect(parseAuditor("audits/code4rena-contest.md")).toBe("Code4rena");
  });

  it("returns null rather than attaching a stranger's name to a report", () => {
    expect(parseAuditor("audits/2023-05-12_final_v2.pdf")).toBeNull();
    expect(parseAuditor("audits/report.pdf")).toBeNull();
    // "Ack3" is a real filename in Lido's audits repo and is not Ackee.
    expect(parseAuditor("Ack3 Lido NEST Audit Report 07-2026.pdf")).toBeNull();
  });

  it("matches a name fenced by underscores — \\b cannot, underscore is a word char", () => {
    // Regression: /\\babdk\\b/ never matches `_ABDK_`. Found against the live
    // Aave audits folder, where every filename uses underscore separators.
    expect(parseAuditor("audits/2022-01-27_ABDK_AaveV3.pdf")).toBe("ABDK");
    expect(parseAuditor("audits/2022-01-24_Certora_AaveV3.pdf")).toBe("Certora");
    expect(parseAuditor("audits/2021-11-01_OpenZeppelin_AaveV3.pdf")).toBe("OpenZeppelin");
  });
});

describe("parseReportDate", () => {
  it("reads the common ISO-ish shapes", () => {
    expect(parseReportDate("audits/2023-05-12-tob.pdf")?.toISOString()).toBe(
      "2023-05-12T00:00:00.000Z",
    );
    expect(parseReportDate("audits/20230512_tob.pdf")?.toISOString()).toBe(
      "2023-05-12T00:00:00.000Z",
    );
    expect(parseReportDate("audits/2023_05_12.pdf")?.toISOString()).toBe(
      "2023-05-12T00:00:00.000Z",
    );
  });

  it("reads day-first dates", () => {
    expect(parseReportDate("audits/12-05-2023-oz.pdf")?.toISOString()).toBe(
      "2023-05-12T00:00:00.000Z",
    );
  });

  it("reads month names in either order", () => {
    expect(parseReportDate("audits/May-2023-halborn.pdf")?.toISOString()).toBe(
      "2023-05-01T00:00:00.000Z",
    );
    expect(parseReportDate("audits/2023-november-zellic.pdf")?.toISOString()).toBe(
      "2023-11-01T00:00:00.000Z",
    );
  });

  it("resolves a day-less date to the FIRST of the month — the conservative read", () => {
    // Earlier report_date can only make coverage look more drifted, never less.
    expect(parseReportDate("audits/2024-03_quantstamp.pdf")?.toISOString()).toBe(
      "2024-03-01T00:00:00.000Z",
    );
  });

  it("reads a month-first date with a four-digit year", () => {
    // "… Audit Report 09-2025.pdf" — Lido's convention, and very common.
    expect(
      parseReportDate("Ackee Blockchain CSM v2 Audit Report 09-2025.pdf")?.toISOString(),
    ).toBe("2025-09-01T00:00:00.000Z");
  });

  it("refuses two-digit years — '10-24' has two readings and feeds computeDrift", () => {
    // October 2024, or the 10th of something in 2024? Null is the honest answer;
    // the scope note carries the commit date as a candidate instead.
    expect(parseReportDate("Ackee Blockchain CSM Report 10-24.pdf")).toBeNull();
    expect(parseReportDate("Lido Simple Delegation audit report 07-24.pdf")).toBeNull();
  });

  it("still reads a day-first date rather than treating it as month-first", () => {
    expect(parseReportDate("audits/12-05-2023-oz.pdf")?.toISOString()).toBe(
      "2023-05-12T00:00:00.000Z",
    );
  });

  it("returns null when the filename states no date — null drives 'unknown'", () => {
    expect(parseReportDate("audits/trail-of-bits-final.pdf")).toBeNull();
    // A bare year is too coarse to compare against an upgrade timestamp.
    expect(parseReportDate("audits/2023.pdf")).toBeNull();
  });

  it("rejects impossible and pre-Ethereum dates rather than clamping them", () => {
    expect(parseReportDate("audits/2023-13-45.pdf")).toBeNull();
    expect(parseReportDate("audits/2023-02-30.pdf")).toBeNull();
    expect(parseReportDate("audits/1999-05-12.pdf")).toBeNull();
  });
});

describe("githubConfigFromEnv", () => {
  it("works with no token at all — sixty calls an hour is enough interactively", () => {
    expect(githubConfigFromEnv({})).toEqual({
      token: null,
      maxReports: 40,
      resolveCommits: true,
    });
  });

  it("reads the token and the knobs", () => {
    expect(
      githubConfigFromEnv({
        GITHUB_TOKEN: " ghp_x ",
        GITHUB_MAX_REPORTS: "5",
        GITHUB_RESOLVE_COMMITS: "false",
      }),
    ).toEqual({ token: "ghp_x", maxReports: 5, resolveCommits: false });
  });

  it("falls back rather than aborting on nonsense", () => {
    expect(githubConfigFromEnv({ GITHUB_MAX_REPORTS: "lots" }).maxReports).toBe(40);
    expect(githubConfigFromEnv({ GITHUB_TOKEN: "  " }).token).toBeNull();
  });
});
