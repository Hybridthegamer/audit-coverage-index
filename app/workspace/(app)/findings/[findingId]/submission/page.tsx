import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Reveal } from "@/components/Reveal";
import { WorkspaceNav } from "@/components/WorkspaceNav";
import { logSubmissionEventAction } from "@/app/workspace/mutations";
import { getSubmissionContext } from "@/db/queries/workspace";
import { renderSubmission } from "@/lib/submission";
import { plural } from "@/lib/format";

/**
 * The submission generator — `vulnerability-submission-template.md`, rendered
 * from a recorded finding.
 *
 * This is the last piece of the workspace loop: the queue finds the target, the
 * explorer and GitHub sweeps establish what is deployed and what was reviewed,
 * the findings editor records the bug, and this is what you actually send. The
 * template's three artefacts go out in order, never all at once, which is why
 * they are three separate blocks with three separate "log this" buttons rather
 * than one document.
 *
 * All the rendering is lib/submission.ts — pure, tested, and the place the
 * three rules live: no PoC code ever (there is no column it could come from),
 * missing fields become loud TODO markers rather than confident blanks, and
 * nothing is inflated. The page's own job is to show the gaps before you send
 * and to make logging the disclosure event a click rather than a chore.
 *
 * force-dynamic: private, per-session, uncached.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Submission",
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="bam-title"
      style={{ marginBottom: "var(--bam-space-md)", marginTop: "var(--bam-space-2xl)" }}
    >
      {children}
    </h2>
  );
}

/**
 * A copy-ready block. Monospace, selectable, and scrolling inside its own box
 * so a long report cannot make the page scroll sideways.
 */
function Artefact({ text }: { text: string }) {
  return (
    <pre
      style={{
        fontFamily: "var(--bam-font-mono)",
        fontSize: "0.8rem",
        lineHeight: 1.6,
        color: "var(--bam-cream-80)",
        background: "rgba(0,0,0,0.25)",
        border: "1px solid var(--bam-cream-20)",
        padding: "var(--bam-space-lg)",
        overflowX: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {text}
    </pre>
  );
}

/** The "I sent this" button that keeps the disclosure timeline honest. */
function LogEvent({
  findingId,
  eventType,
  label,
}: {
  findingId: number;
  eventType: string;
  label: string;
}) {
  return (
    <form action={logSubmissionEventAction} style={{ marginTop: "var(--bam-space-md)" }}>
      <input type="hidden" name="findingId" value={findingId} />
      <input type="hidden" name="eventType" value={eventType} />
      <input type="hidden" name="channel" value="email" />
      <button type="submit" className="bam-btn-sm">
        {label}
      </button>
    </form>
  );
}

export default async function SubmissionPage({
  params,
}: {
  params: Promise<{ findingId: string }>;
}) {
  const { findingId: raw } = await params;
  const findingId = Number(raw);
  if (!Number.isInteger(findingId) || findingId <= 0) notFound();

  const context = await getSubmissionContext(findingId);
  if (!context) notFound();

  const artefacts = renderSubmission(context);

  return (
    <>
      <WorkspaceNav page="SUBMISSION" />

      <main className="bam-page">
        <section
          className="bam-pad-x"
          style={{
            paddingTop: "var(--bam-space-2xl)",
            paddingBottom: "var(--bam-space-3xl)",
          }}
        >
          <div className="bam-mid">
            <Reveal>
              <p className="bam-eyebrow">
                <Link
                  href={`/workspace/findings/${findingId}`}
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  ← {context.title.toUpperCase()}
                </Link>
              </p>
              <h1 className="bam-headline">Submission.</h1>
              <p
                className="bam-body"
                style={{ maxWidth: "58ch", marginTop: "var(--bam-space-lg)" }}
              >
                Three artefacts, sent in order and never all at once: contact
                first with no technical detail, the full report once they reply
                and you have a channel, the fix-verification note after they
                patch. Generated from what this finding actually records —
                nothing is inflated and nothing is filled in for you.
              </p>
            </Reveal>

            {/* ─── What is still missing ─────────────────────────────── */}
            {artefacts.missing.length > 0 ? (
              <Reveal>
                <div
                  className="bam-notice"
                  style={{
                    marginTop: "var(--bam-space-xl)",
                    borderColor: "var(--bam-red)",
                  }}
                >
                  <p className="bam-notice-label" style={{ color: "var(--bam-red)" }}>
                    {plural(artefacts.missing.length, "FIELD")} STILL MISSING
                  </p>
                  <div className="bam-notice-body">
                    <p style={{ marginBottom: "var(--bam-space-sm)" }}>
                      Each one appears as a <code>[TODO: …]</code> marker in the
                      report below. Fill them in on the finding before you send:
                      a half-filled report sent confidently is the fastest way to
                      lose a triager for every report after it.
                    </p>
                    <ul style={{ paddingLeft: "1.2rem" }}>
                      {artefacts.missing.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <p style={{ marginTop: "var(--bam-space-sm)" }}>
                      <Link
                        href={`/workspace/findings/${findingId}`}
                        style={{
                          color: "var(--bam-cream-80)",
                          borderBottom: "1px solid var(--bam-cream-20)",
                          textDecoration: "none",
                        }}
                      >
                        Edit the finding ↗
                      </Link>
                    </p>
                  </div>
                </div>
              </Reveal>
            ) : null}

            {/* ─── 1. Initial contact ────────────────────────────────── */}
            <Reveal>
              <SectionTitle>1 · Initial contact</SectionTitle>
              <p
                className="bam-body"
                style={{ maxWidth: "58ch", marginBottom: "var(--bam-space-md)" }}
              >
                Plain text. No markdown, no attachments, no PoC. Its only job is
                to open a channel and get safe harbour confirmed. Two follow-ups
                spaced four or five days; after the second, one note that you
                will route through SEAL 911 if the issue is live — then do it.
              </p>
              <Artefact text={artefacts.initialContact} />
              <LogEvent
                findingId={findingId}
                eventType="initial_contact"
                label="Log initial contact"
              />
            </Reveal>

            {/* ─── 2. Full report ────────────────────────────────────── */}
            <Reveal>
              <SectionTitle>2 · Full report</SectionTitle>
              <p
                className="bam-body"
                style={{ maxWidth: "58ch", marginBottom: "var(--bam-space-md)" }}
              >
                Only once they have replied and you have an agreed channel.
                Markdown is fine here. The proof of concept is referenced by
                pointer — this index stores a reference to a runnable exploit,
                never the exploit — so attach the test out-of-band.
              </p>
              <Artefact text={artefacts.fullReport} />
              <LogEvent
                findingId={findingId}
                eventType="report_sent"
                label="Log report sent"
              />
            </Reveal>

            {/* ─── 3. Fix verification ───────────────────────────────── */}
            <Reveal>
              <SectionTitle>3 · Fix verification</SectionTitle>
              <p
                className="bam-body"
                style={{ maxWidth: "58ch", marginBottom: "var(--bam-space-md)" }}
              >
                After they patch. Short, and worth sending even when the fix is
                fine — this is the message that converts a bounty submission into
                an audit engagement more often than anything else you send.
              </p>
              <Artefact text={artefacts.fixVerification} />
              <LogEvent
                findingId={findingId}
                eventType="fix_deployed"
                label="Log fix deployed"
              />
            </Reveal>
          </div>
        </section>
      </main>
    </>
  );
}
