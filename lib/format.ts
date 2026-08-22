import type { CoverageState } from "@/lib/drift";

/**
 * Presentation helpers shared by the public routes and the OG image renderers.
 * Pure and dependency-free so the edge runtime (OG images) can import them.
 *
 * Everything here is deliberately locale-fixed to en-US and UTC. These pages
 * are ISR-cached HTML: formatting against the server's locale or timezone would
 * bake one visitor's rendering into the cache for everyone.
 */

export const COVERAGE_LABEL: Record<CoverageState, string> = {
  current: "Current",
  drifted: "Drifted",
  uncovered: "Uncovered",
  unknown: "Unknown",
};

/** One line explaining what each state actually asserts. Used in legends. */
export const COVERAGE_MEANING: Record<CoverageState, string> = {
  current: "An audit covers the deployed commit, and nothing shipped since.",
  drifted: "An audit covered this code once. It has been upgraded since.",
  uncovered: "The deployed code is downstream of every audit. Nobody reviewed it.",
  unknown: "Not enough recorded data to evaluate. We do not guess.",
};

export const CHAIN_LABEL: Record<string, string> = {
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
  base: "Base",
  optimism: "Optimism",
  bsc: "BNB Chain",
  polygon: "Polygon",
  solana: "Solana",
  stacks: "Stacks",
  aptos: "Aptos",
  sui: "Sui",
  osmosis: "Osmosis",
  neutron: "Neutron",
  injective: "Injective",
  sei: "Sei",
  starknet: "Starknet",
  ton: "TON",
};

export function chainLabel(chain: string): string {
  return CHAIN_LABEL[chain] ?? chain;
}

/**
 * Private research-queue status labels. Used only by the authenticated
 * workspace, but kept here with the other label maps so presentation stays in
 * one place. `null` renders as "Unqueued" — a target with no queue item yet.
 */
export const QUEUE_STATUS_LABEL: Record<string, string> = {
  candidate: "Candidate",
  queued: "Queued",
  in_review: "In review",
  cleared: "Cleared",
  finding_found: "Finding",
  dropped: "Dropped",
};

export function queueStatusLabel(status: string | null): string {
  if (status === null) return "Unqueued";
  return QUEUE_STATUS_LABEL[status] ?? status;
}

/**
 * Audit-presence labels (step 6). The curation-layer signal: "has anybody
 * reviewed this project at all", which is a different and much weaker claim
 * than coverage state. Kept verbally distinct from COVERAGE_LABEL for that
 * reason — "Unaudited" is not "Uncovered", and nothing here is ever red.
 */
export const AUDIT_STATUS_LABEL: Record<string, string> = {
  audited: "Audited",
  unaudited: "No audit",
};

export function auditStatusLabel(status: string): string {
  return AUDIT_STATUS_LABEL[status] ?? status;
}

/** Finding lifecycle labels (private workspace, step 5). */
export const FINDING_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  contact_sent: "Contact sent",
  acknowledged: "Acknowledged",
  triaged: "Triaged",
  accepted: "Accepted",
  fixed: "Fixed",
  disputed: "Disputed",
  duplicate: "Duplicate",
  no_response: "No response",
};

export function findingStatusLabel(status: string): string {
  return FINDING_STATUS_LABEL[status] ?? status;
}

/** Disclosure-timeline event labels (private workspace, step 5). */
export const DISCLOSURE_EVENT_LABEL: Record<string, string> = {
  initial_contact: "Initial contact",
  follow_up: "Follow-up",
  reply_received: "Reply received",
  report_sent: "Report sent",
  ack: "Acknowledged",
  fix_deployed: "Fix deployed",
  payout: "Payout",
  escalated_seal911: "Escalated (SEAL 911)",
  published: "Published",
};

export function disclosureEventLabel(type: string): string {
  return DISCLOSURE_EVENT_LABEL[type] ?? type;
}

/** Em dash for absent values — never "null", never a bare empty cell. */
export const EMPTY = "—";

/** `2024-11-02`. ISO date, UTC, sortable, unambiguous across locales. */
export function formatDate(value: Date | null): string {
  if (!value) return EMPTY;
  const iso = value.toISOString();
  return iso.slice(0, 10);
}

/** `2024-11-02 14:30 UTC`. Timestamp for the private workspace (upgrade log). */
export function formatDateTime(value: Date | null): string {
  if (!value) return EMPTY;
  const iso = value.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** `$1.2B` / `$340.5M` / `$12.0K`. Compact, because the column is narrow. */
export function formatTvl(value: number | null): string {
  if (value === null) return EMPTY;
  if (value < 1) return "$0";

  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (value >= size) {
      return `$${(value / size).toFixed(1)}${suffix}`;
    }
  }
  return `$${Math.round(value)}`;
}

/**
 * Drift in days. Zero is meaningful ("covered, nothing shipped since") and
 * renders as `0`, distinct from null which renders as the em dash.
 */
export function formatDrift(days: number | null): string {
  if (days === null) return EMPTY;
  return String(days);
}

/** `0xA0b8…eB48` — enough to recognise, short enough for a dense cell. */
export function truncateAddress(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** First 7 characters, the way git itself abbreviates. */
export function shortCommit(commit: string | null): string {
  if (!commit) return EMPTY;
  return commit.slice(0, 7);
}

/**
 * `1 contract` / `2 contracts`. These counts are driven by live data that
 * regularly lands on exactly one, and "1 contracts nobody reviewed" undercuts
 * the one sentence the whole site exists to say — so every rendered count goes
 * through here rather than hard-coding an "s".
 */
export function plural(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
