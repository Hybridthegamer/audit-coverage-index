import { COVERAGE_LABEL, EMPTY } from "@/lib/format";
import type { CoverageState } from "@/lib/drift";

/**
 * Submission generator (build step 7).
 *
 * Renders a finding into the three artefacts of
 * `vulnerability-submission-template.md`: the initial contact, the full report,
 * and the fix-verification note. It is the last piece of the loop the workspace
 * has been building toward — the queue finds the target, the findings editor
 * records the bug, the disclosure timeline tracks the conversation, and this is
 * what you actually send.
 *
 * Pure, like lib/drift.ts and lib/priority.ts: no DB, no clock unless injected,
 * no network. It takes a context object and returns strings. That keeps the
 * whole template testable and lets the same function serve a page render and,
 * later, anything else that wants the text.
 *
 * ── Three rules it enforces, because a template cannot ────────────────────
 *
 * 1. NO PROOF-OF-CONCEPT CODE. `findings.poc_ref` is a string pointer and the
 *    schema has no `poc_code` column (CLAUDE.md, hard constraint). The PoC
 *    section renders the pointer and tells the researcher to attach the runnable
 *    test out-of-band. A generator that inlined exploit code would put runnable
 *    exploits in the database by the back door — as a rendered artefact of it,
 *    which is the same thing.
 *
 * 2. MISSING DATA IS VISIBLE. Every unfilled field becomes a `[TODO: …]` marker
 *    rather than an empty heading or a plausible blank. The template's own
 *    closing section lists what sinks a report, and a half-filled report sent
 *    confidently is top of that list. A researcher must not be able to paste
 *    this into an email and not notice the gaps.
 *
 * 3. IT NEVER INFLATES. Severity, funds at risk and the coverage claim are
 *    rendered exactly as recorded; nothing is upgraded, rounded up, or softened.
 *    The template is explicit — "Don't inflate… getting bumped down reads as
 *    inexperience" — and this is the one place the tool could quietly do it.
 *
 * The post-audit callout is the exception worth having: when
 * `in_post_audit_code` is true, the report says so in the scope section, in
 * bold, because that is the entire thesis of this project and the template asks
 * for it explicitly ("If the bug lives in code that shipped after the audit, say
 * so here. It changes how the team receives the report.").
 */

/** Who is sending. Overridable; these are the template's defaults. */
export interface Researcher {
  name: string;
  github: string;
  twitter: string;
}

export const DEFAULT_RESEARCHER: Researcher = {
  name: "Franklin Nwachukwu",
  github: "github.com/Hybridthegamer",
  twitter: "x.com/hybridthegeek",
};

/** The covering audit, when one is recorded. */
export interface SubmissionAudit {
  auditor: string;
  reportDate: Date | null;
  reviewedCommit: string | null;
  reportUrl: string | null;
}

/** Everything the three artefacts need, gathered by the query layer. */
export interface SubmissionContext {
  protocolName: string;
  securityContact: string | null;
  website: string | null;
  githubRepo: string | null;
  hasBounty: boolean;
  bountyPlatform: string;
  bountyUrl: string | null;

  chain: string;
  addressOrProgramId: string;
  deploymentLabel: string | null;
  deployedCommit: string | null;
  explorerUrl: string | null;
  coverageState: CoverageState;
  driftDays: number | null;

  title: string;
  severity: string | null;
  immunefiClass: string | null;
  fundsAtRiskUsd: number | null;
  summary: string | null;
  rootCause: string | null;
  attackPath: string | null;
  preconditions: string | null;
  impact: string | null;
  recommendedFix: string | null;
  /** A pointer. Never code — see rule 1 in the module header. */
  pocRef: string | null;
  inPostAuditCode: boolean;

  /** The audit this finding's code should have been covered by, if any. */
  coveringAudit: SubmissionAudit | null;
  /** First contact, from the disclosure timeline. Null = not yet contacted. */
  firstContactAt: Date | null;

  researcher?: Researcher;
  /** Injected clock, so the rendered dates are deterministic in tests. */
  now?: Date;
}

export interface SubmissionArtefacts {
  initialContact: string;
  fullReport: string;
  fixVerification: string;
  /** Every field the report is missing, so the page can say so up front. */
  missing: string[];
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const DISCLOSURE_WINDOW_DAYS = 90;
const MS_PER_DAY = 86_400_000;

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * A recorded value, or a loud marker. The marker is deliberately ugly: it has
 * to survive a skim of a long markdown document and stop the send.
 */
function required(value: string | null, hint: string, missing: string[]): string {
  if (value !== null && value.trim().length > 0) return value.trim();
  missing.push(hint);
  return `[TODO: ${hint}]`;
}

/** An optional value rendered as-is, or the em dash the rest of the app uses. */
function optional(value: string | null): string {
  return value !== null && value.trim().length > 0 ? value.trim() : EMPTY;
}

/**
 * Money, rendered exactly. Not `formatTvl`'s compact `$1.2M`: a submission
 * states a figure a triager will check, and "$1.2M" is not a figure.
 */
function exactUsd(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function shortCommit(value: string | null): string {
  if (value === null || value.length === 0) return EMPTY;
  return value.slice(0, 12);
}

/* ------------------------------------------------------------------ *
 * Artefact 1 — initial contact
 * ------------------------------------------------------------------ */

/**
 * Plain text, no markdown, no attachments, no technical detail. Its only job is
 * to open a channel and ask the three questions, and everything it says has to
 * survive being pasted into a webmail composer.
 *
 * The severity word is the one the finding records, lowercased into the
 * sentence. When nothing is recorded it is a TODO rather than a default of
 * "high" — picking a severity on the researcher's behalf is exactly the
 * inflation rule 3 forbids.
 */
export function renderInitialContact(context: SubmissionContext): string {
  const missing: string[] = [];
  const researcher = context.researcher ?? DEFAULT_RESEARCHER;

  const severity = required(
    context.severity,
    "severity (Critical / High / Medium / Low)",
    missing,
  ).toLowerCase();

  const contractName = context.deploymentLabel ?? "the deployed contract";
  const recipient = context.securityContact ?? `${context.protocolName} team`;

  return [
    `Subject: Security disclosure — ${context.protocolName} ${contractName}`,
    "",
    `Hi ${recipient},`,
    "",
    "I'm a security researcher working on Solana and EVM protocols. I've found",
    `what looks like a ${severity}-severity issue in ${contractName} at`,
    `${context.addressOrProgramId} on ${context.chain}.`,
    "",
    "Before I send details, could you confirm:",
    "",
    "1. Is there a disclosure policy or bug bounty I should be submitting through?",
    "2. Does good-faith research on your deployed contracts have safe harbour?",
    "3. What's your response window? I work to 90 days by default.",
    "",
    "I haven't shared this with anyone and won't until we've agreed a process.",
    "Happy to move to Signal or PGP if you'd prefer.",
    "",
    researcher.name,
    researcher.github,
    researcher.twitter,
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * Artefact 2 — the full report
 * ------------------------------------------------------------------ */

function renderScopeTable(context: SubmissionContext): string {
  const audit = context.coveringAudit;
  const auditedCommit =
    audit === null
      ? "— (no audit on record covers this deployment)"
      : `\`${shortCommit(audit.reviewedCommit)}\` (${audit.auditor}${
          audit.reportDate !== null ? `, ${isoDate(audit.reportDate)}` : ", date unknown"
        })`;

  const rows: [string, string][] = [
    ["Chain", context.chain],
    [
      "Contract / program",
      context.explorerUrl !== null
        ? `[\`${context.addressOrProgramId}\`](${context.explorerUrl})`
        : `\`${context.addressOrProgramId}\``,
    ],
    ["Deployed commit", context.deployedCommit !== null
      ? `\`${shortCommit(context.deployedCommit)}\``
      : "[TODO: pin the deployed commit]"],
    ["Audited commit", auditedCommit],
    ["Coverage state", COVERAGE_LABEL[context.coverageState]],
    ["Repo", optional(context.githubRepo)],
  ];

  return [
    "| | |",
    "|---|---|",
    ...rows.map(([key, value]) => `| ${key} | ${value} |`),
  ].join("\n");
}

/**
 * The scope section's post-audit paragraph — this project's whole argument,
 * stated in the one document where it changes the outcome.
 *
 * Only rendered when the finding is actually flagged post-audit. Attaching the
 * claim to a bug that predates the audit would be the report making an
 * assertion the data does not support, which is the fastest way to lose a
 * triager's trust for every report after it.
 */
function renderPostAuditNote(context: SubmissionContext): string | null {
  if (!context.inPostAuditCode) return null;

  const drift =
    context.driftDays !== null && context.driftDays > 0
      ? ` The deployed code has been ${context.driftDays} days ahead of that review.`
      : "";

  const audit = context.coveringAudit;
  const reviewed =
    audit !== null
      ? `The most recent audit on record is ${audit.auditor}${
          audit.reportDate !== null ? ` (${isoDate(audit.reportDate)})` : ""
        }, and this code is not in what they reviewed.`
      : "There is no audit on record covering the deployed code at all.";

  return [
    "**This bug is in code that shipped after your last audit.** " + reviewed + drift,
    "",
    "I'm flagging it explicitly because it changes what the finding means: this",
    "is not something a reviewer missed, it is code no reviewer has seen.",
  ].join("\n");
}

/**
 * The PoC section. Renders the POINTER and nothing else — see rule 1 in the
 * module header. There is no code path here that can emit exploit code, because
 * there is no column it could come from.
 */
function renderPocSection(context: SubmissionContext, missing: string[]): string {
  if (context.pocRef === null || context.pocRef.trim().length === 0) {
    missing.push("proof of concept (poc_ref)");
    return [
      "[TODO: attach the runnable PoC.]",
      "",
      "A Foundry / Anchor / Clarinet test, forked at a real mainnet block, with",
      "the block number stated and the profit output pasted. The template is",
      "explicit that a PoC which does not run on a clean checkout sinks the",
      "report.",
    ].join("\n");
  }

  return [
    `Proof of concept: \`${context.pocRef.trim()}\``,
    "",
    "The runnable test is attached out-of-band at the pointer above — this index",
    "stores a reference to it, never the exploit itself. Fork a real mainnet",
    "block, state the block number, and paste the output showing the profit.",
  ].join("\n");
}

function renderDisclosureTerms(context: SubmissionContext): string {
  const now = context.now ?? new Date();
  const reported = context.firstContactAt ?? now;
  const deadline = new Date(reported.getTime() + DISCLOSURE_WINDOW_DAYS * MS_PER_DAY);

  return [
    `- Reported ${isoDate(reported)}` +
      (context.firstContactAt === null ? " (first contact not yet logged)" : ""),
    "- Requesting acknowledgement within 5 business days",
    `- ${DISCLOSURE_WINDOW_DAYS}-day disclosure window from first contact — ${isoDate(deadline)}`,
    "- Happy to extend if a fix is in progress and you're keeping me updated",
    "- I'd like to publish a writeup after the fix is live and users have",
    "  migrated. Send me a draft to review if you'd prefer to coordinate wording.",
  ].join("\n");
}

export function renderFullReport(context: SubmissionContext): {
  markdown: string;
  missing: string[];
} {
  const missing: string[] = [];

  const severity = required(
    context.severity,
    "severity (Critical / High / Medium / Low)",
    missing,
  );
  const summary = required(
    context.summary,
    "summary — what breaks, who loses money, roughly how much",
    missing,
  );
  const rootCause = required(
    context.rootCause,
    "root cause — one sentence naming the mistake",
    missing,
  );
  const attackPath = required(
    context.attackPath,
    "attack path — numbered steps with concrete values",
    missing,
  );
  const impact = required(
    context.impact,
    "impact — quantified, with the arithmetic",
    missing,
  );
  const recommendedFix = required(
    context.recommendedFix,
    "recommended fix — concrete, diff format where possible",
    missing,
  );

  const funds = exactUsd(context.fundsAtRiskUsd);
  if (funds === null) missing.push("funds at risk");

  const immunefiClass = context.immunefiClass;
  if (immunefiClass === null) {
    missing.push("Immunefi classification");
  }

  const postAudit = renderPostAuditNote(context);

  const sections: string[] = [
    `# [${severity}] — ${context.title}`,
    "",
    "## Summary",
    "",
    summary,
    "",
    "## Severity",
    "",
    `**Rating:** ${severity}`,
    `**Immunefi classification:** ${
      immunefiClass ?? "[TODO: use Immunefi's exact wording so triage doesn't translate]"
    }`,
    `**Funds at risk:** ${funds ?? "[TODO: state the figure and show the arithmetic]"}`,
    "",
    "## Scope",
    "",
    renderScopeTable(context),
  ];

  if (postAudit !== null) {
    sections.push("", postAudit);
  }

  sections.push(
    "",
    "## Vulnerability details",
    "",
    "[TODO: what the code is supposed to do, what it actually does, the gap —",
    "citing exact lines from the deployed commit.]",
    "",
    "## Root cause",
    "",
    rootCause,
    "",
    "## Attack path",
    "",
    attackPath,
    "",
    "**Preconditions:** " +
      (context.preconditions !== null && context.preconditions.trim().length > 0
        ? context.preconditions.trim()
        : "[TODO: what has to be true. Be honest — overstating " +
          "preconditions-free exploitability is how researchers burn credibility.]"),
    "",
    "## Proof of concept",
    "",
    renderPocSection(context, missing),
    "",
    "## Impact",
    "",
    impact,
    "",
    "## Recommended fix",
    "",
    recommendedFix,
    "",
    "## Disclosure terms",
    "",
    renderDisclosureTerms(context),
  );

  if (context.hasBounty && context.bountyUrl !== null) {
    sections.push(
      "",
      `Submitting through ${context.bountyPlatform}: ${context.bountyUrl}`,
    );
  }

  return { markdown: sections.join("\n"), missing };
}

/* ------------------------------------------------------------------ *
 * Artefact 3 — fix verification
 * ------------------------------------------------------------------ */

/**
 * The note sent after they patch — short, and worth sending even when the fix
 * is fine. The template's own line about it is the reason it is generated at
 * all: "This is the email that converts a bounty submission into an audit
 * contract more often than anything else you'll send."
 *
 * Almost entirely TODO by design. It is the one artefact whose content cannot
 * exist before the fix does, so what it offers is the shape and the reminder,
 * not filled-in prose.
 */
export function renderFixVerification(context: SubmissionContext): string {
  return [
    `Reviewed the fix at [TODO: fix commit] for "${context.title}".`,
    "",
    "[TODO: state plainly whether the PoC still profits. If it reverts, say",
    "where and why.]",
    "",
    "[TODO: one thing worth flagging — the same pattern elsewhere in the",
    "codebase, not exploitable today because [reason], but the same bug if",
    "[constraint] is ever removed. Volunteering this is what turns a bounty",
    "submission into an engagement.]",
    "",
    "Once the fix is live and users have migrated I'd like to publish a short",
    "writeup. Happy to send you a draft first.",
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * All three
 * ------------------------------------------------------------------ */

/** Render every artefact plus the list of what is still missing. */
export function renderSubmission(context: SubmissionContext): SubmissionArtefacts {
  const report = renderFullReport(context);
  return {
    initialContact: renderInitialContact(context),
    fullReport: report.markdown,
    fixVerification: renderFixVerification(context),
    // De-duplicated: severity is required by two artefacts and should be
    // reported once.
    missing: [...new Set(report.missing)],
  };
}
