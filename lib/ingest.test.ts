import { describe, expect, it } from "vitest";

import {
  AUDIT_COUNT_MARKER_KEY,
  auditDedupKey,
  DEFILLAMA_AUDITOR,
  needsCandidate,
  planAuditRows,
  planProtocolWrite,
  type ExistingProtocol,
} from "./ingest";
import type { SourcedProtocol } from "./sources/defillama";

describe("needsCandidate", () => {
  it("queues live unreviewed code — uncovered and drifted — when nothing open tracks it", () => {
    expect(needsCandidate("uncovered", false)).toBe(true);
    expect(needsCandidate("drifted", false)).toBe(true);
  });

  it("never queues covered or unevaluable deployments", () => {
    expect(needsCandidate("current", false)).toBe(false);
    expect(needsCandidate("unknown", false)).toBe(false);
  });

  it("never double-queues a deployment that already has an open item", () => {
    expect(needsCandidate("uncovered", true)).toBe(false);
    expect(needsCandidate("drifted", true)).toBe(false);
    expect(needsCandidate("current", true)).toBe(false);
    expect(needsCandidate("unknown", true)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Sourcing planners (build step 6). These are the pure half of
   syncFromDefiLlama: the decisions that make a re-run idempotent and stop the
   sync from overwriting anything a researcher recorded by hand.
   ═══════════════════════════════════════════════════════════════════════════ */

const record = (over: Partial<SourcedProtocol> = {}): SourcedProtocol => ({
  slug: "lido",
  name: "Lido",
  website: "https://lido.fi/",
  twitter: "LidoFinance",
  githubRepo: "https://github.com/lidofinance",
  defillamaId: "lido",
  tvlUsd: 23_398_117_769.06,
  category: "Liquid Staking",
  chains: ["Ethereum"],
  auditCount: 2,
  auditLinks: ["https://github.com/lidofinance/audits"],
  inactive: false,
  ...over,
});

const existing = (over: Partial<ExistingProtocol> = {}): ExistingProtocol => ({
  id: 1,
  slug: "lido",
  name: "Lido",
  website: "https://lido.fi/",
  twitter: "LidoFinance",
  githubRepo: "https://github.com/lidofinance",
  category: "Liquid Staking",
  chains: ["Ethereum"],
  defillamaId: "lido",
  tvlUsd: "23398117769.06",
  ...over,
});

describe("planProtocolWrite", () => {
  it("inserts an unseen slug with every sourced field", () => {
    const plan = planProtocolWrite(undefined, record());
    expect(plan.action).toBe("insert");
    expect(plan.values).toEqual({
      slug: "lido",
      name: "Lido",
      website: "https://lido.fi/",
      twitter: "LidoFinance",
      githubRepo: "https://github.com/lidofinance",
      defillamaId: "lido",
      tvlUsd: "23398117769.06",
      category: "Liquid Staking",
      chains: ["Ethereum"],
    });
  });

  it("writes nothing when a re-run finds the same data — the idempotency case", () => {
    expect(planProtocolWrite(existing(), record()).action).toBe("unchanged");
  });

  it("updates when TVL moves, and formats it to the numeric(30,2) column", () => {
    const plan = planProtocolWrite(existing(), record({ tvlUsd: 100.5 }));
    expect(plan.action).toBe("update");
    expect(plan.values.tvlUsd).toBe("100.50");
  });

  it("clears TVL to null when the feed stops reporting it", () => {
    const plan = planProtocolWrite(existing(), record({ tvlUsd: null }));
    expect(plan.action).toBe("update");
    expect(plan.values.tvlUsd).toBeNull();
  });

  it("never blanks a website or twitter the feed happens to have dropped", () => {
    const plan = planProtocolWrite(
      existing(),
      record({ website: null, twitter: null }),
    );
    expect(plan.action).toBe("unchanged");
    expect(plan.values.website).toBe("https://lido.fi/");
    expect(plan.values.twitter).toBe("LidoFinance");
  });

  it("fills github_repo when empty but never replaces a hand-recorded repo", () => {
    const filled = planProtocolWrite(existing({ githubRepo: null }), record());
    expect(filled.action).toBe("update");
    expect(filled.values.githubRepo).toBe("https://github.com/lidofinance");

    // The feed only knows the org page; a recorded repo URL is strictly better.
    const kept = planProtocolWrite(
      existing({ githubRepo: "https://github.com/lidofinance/lido-dao" }),
      record(),
    );
    expect(kept.action).toBe("unchanged");
    expect(kept.values.githubRepo).toBe("https://github.com/lidofinance/lido-dao");
  });

  it("emits no is_published, archived, bounty or security_contact key at all", () => {
    // The write payload IS the security boundary here: a key that is absent
    // cannot be written, so a re-run can never republish a retracted protocol.
    const keys = Object.keys(planProtocolWrite(undefined, record()).values).sort();
    expect(keys).toEqual([
      "category",
      "chains",
      "defillamaId",
      "githubRepo",
      "name",
      "slug",
      "tvlUsd",
      "twitter",
      "website",
    ]);
  });
});

describe("planAuditRows", () => {
  it("creates one marker per report link, with no date and no reviewed commit", () => {
    const rows = planAuditRows(record(), new Set());
    expect(rows).toEqual([
      {
        auditor: DEFILLAMA_AUDITOR,
        reportUrl: "https://github.com/lidofinance/audits",
        scopeNote: expect.stringContaining("Sourced from DefiLlama"),
      },
    ]);
  });

  it("skips a link already on file — the re-run case", () => {
    const rows = planAuditRows(
      record(),
      new Set(["https://github.com/lidofinance/audits"]),
    );
    expect(rows).toEqual([]);
  });

  it("records a count-only marker when the feed claims audits but lists no links", () => {
    // Real shape: Aerodrome Slipstream ships audits:"3", audit_links:[].
    const rows = planAuditRows(record({ auditCount: 3, auditLinks: [] }), new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reportUrl).toBeNull();
    expect(rows[0]!.scopeNote).toContain("3 audit(s)");
  });

  it("never duplicates the count-only marker across runs", () => {
    const rows = planAuditRows(
      record({ auditCount: 3, auditLinks: [] }),
      new Set([AUDIT_COUNT_MARKER_KEY]),
    );
    expect(rows).toEqual([]);
  });

  it("files nothing for a genuinely unaudited protocol", () => {
    expect(planAuditRows(record({ auditCount: 0, auditLinks: [] }), new Set())).toEqual(
      [],
    );
  });

  it("prefers real links over the count marker when both are available", () => {
    const rows = planAuditRows(record({ auditCount: 5 }), new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reportUrl).not.toBeNull();
  });
});

describe("auditDedupKey", () => {
  it("keys any audit with a URL by that URL, whoever recorded it", () => {
    expect(auditDedupKey("https://a.example/r.pdf", "auditor_site")).toBe(
      "https://a.example/r.pdf",
    );
  });

  it("counts a URL-less row as the marker only when the sync wrote it", () => {
    expect(auditDedupKey(null, "defillama")).toBe(AUDIT_COUNT_MARKER_KEY);
    // A hand-entered audit with no link is a different assertion; it must not
    // suppress the marker the feed's count deserves.
    expect(auditDedupKey(null, "protocol_docs")).toBeNull();
  });
});
