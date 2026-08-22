import { describe, expect, it } from "vitest";

import { needsCandidate } from "./ingest";

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
