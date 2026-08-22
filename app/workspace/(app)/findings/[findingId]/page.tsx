import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FindingForm } from "@/components/FindingForm";
import { Reveal } from "@/components/Reveal";
import { WorkspaceNav } from "@/components/WorkspaceNav";
import {
  addDisclosureEvent,
  deleteDisclosureEvent,
  deleteFinding,
  updateFinding,
} from "@/app/workspace/mutations";
import { getFinding } from "@/db/queries/workspace";
import {
  DISCLOSURE_EVENT_LABEL,
  chainLabel,
  disclosureEventLabel,
  findingStatusLabel,
  formatDateTime,
  formatTvl,
  truncateAddress,
} from "@/lib/format";

/**
 * The findings editor + disclosure timeline for one finding. The top half edits
 * the finding; the bottom half is the disclosure log — a reverse-chronological
 * timeline of contact events, with a form to append the next one.
 *
 * force-dynamic: private, per-session, uncached.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Finding",
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="bam-title"
      style={{ marginBottom: "var(--bam-space-lg)", marginTop: "var(--bam-space-2xl)" }}
    >
      {children}
    </h2>
  );
}

export default async function FindingPage({
  params,
}: {
  params: Promise<{ findingId: string }>;
}) {
  const { findingId: raw } = await params;
  const findingId = Number(raw);
  if (!Number.isInteger(findingId) || findingId <= 0) notFound();

  const finding = await getFinding(findingId);
  if (!finding) notFound();

  return (
    <>
      <WorkspaceNav page={finding.protocolName.toUpperCase()} />

      <main className="bam-page">
        <section
          className="bam-pad-x"
          style={{
            paddingTop: "var(--bam-space-2xl)",
            paddingBottom: "var(--bam-space-3xl)",
          }}
        >
          <div className="bam-mid">
            {/* ─── Header ────────────────────────────────────────────── */}
            <Reveal>
              <p className="bam-eyebrow">
                <Link
                  href={`/workspace/targets/${finding.deploymentId}`}
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  ← {finding.protocolName.toUpperCase()}
                </Link>
              </p>
              <h1 className="bam-headline">{finding.title}</h1>
              <div
                style={{
                  display: "flex",
                  gap: "var(--bam-space-lg)",
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginTop: "var(--bam-space-md)",
                }}
              >
                <span className="bam-badge bam-badge--confirmed">
                  {findingStatusLabel(finding.status)}
                </span>
                {finding.severity ? (
                  <span className="bam-badge bam-badge--pending">
                    {finding.severity}
                  </span>
                ) : null}
                {finding.inPostAuditCode ? (
                  <span className="bam-badge bam-badge--record">Post-audit code</span>
                ) : null}
                <span
                  style={{
                    fontSize: "var(--bam-t-micro)",
                    color: "var(--bam-cream-40)",
                  }}
                >
                  {chainLabel(finding.chain)} ·{" "}
                  {truncateAddress(finding.addressOrProgramId)} ·{" "}
                  {finding.fundsAtRiskUsd !== null
                    ? `${formatTvl(finding.fundsAtRiskUsd)} at risk`
                    : "risk unquantified"}
                </span>
              </div>
            </Reveal>

            {/* ─── Editor ────────────────────────────────────────────── */}
            <Reveal>
              <SectionTitle>Edit</SectionTitle>
              <FindingForm
                action={updateFinding}
                findingId={finding.id}
                initial={finding}
                submitLabel="Save finding"
              />
            </Reveal>

            {/* ─── Disclosure timeline ───────────────────────────────── */}
            <Reveal>
              <SectionTitle>Disclosure timeline</SectionTitle>

              {finding.disclosureEvents.length === 0 ? (
                <p className="bam-body">
                  No disclosure events yet. The first is usually initial contact.
                </p>
              ) : (
                <ul className="bam-timeline">
                  {finding.disclosureEvents.map((ev) => (
                    <li
                      key={ev.id}
                      className={`bam-timeline-item${
                        ev.eventType === "published"
                          ? " bam-timeline-item--published"
                          : ""
                      }`}
                    >
                      <div className="bam-timeline-when">
                        {formatDateTime(ev.occurredAt)}
                        {ev.channel ? ` · ${ev.channel}` : ""}
                      </div>
                      <div className="bam-timeline-what">
                        {disclosureEventLabel(ev.eventType)}
                      </div>
                      {ev.note ? (
                        <div className="bam-timeline-note">{ev.note}</div>
                      ) : null}
                      <form
                        action={deleteDisclosureEvent}
                        style={{ marginTop: "0.5rem" }}
                      >
                        <input type="hidden" name="eventId" value={ev.id} />
                        <input type="hidden" name="findingId" value={finding.id} />
                        <button
                          type="submit"
                          className="bam-btn-sm bam-btn-sm--danger"
                        >
                          Delete event
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}

              {/* Add event */}
              <div style={{ marginTop: "var(--bam-space-xl)" }}>
                <p
                  className="bam-data-key"
                  style={{ marginBottom: "var(--bam-space-md)" }}
                >
                  Add event
                </p>
                <form action={addDisclosureEvent}>
                  <input type="hidden" name="findingId" value={finding.id} />
                  <div className="bam-form-grid">
                    <div className="bam-field">
                      <label className="bam-label" htmlFor="eventType">
                        Type
                      </label>
                      <select
                        id="eventType"
                        name="eventType"
                        className="bam-input"
                        defaultValue="initial_contact"
                      >
                        {Object.entries(DISCLOSURE_EVENT_LABEL).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                    <div className="bam-field">
                      <label className="bam-label" htmlFor="channel">
                        Channel
                      </label>
                      <input
                        id="channel"
                        name="channel"
                        className="bam-input"
                        placeholder="email / immunefi / twitter dm"
                      />
                    </div>
                  </div>
                  <div className="bam-field">
                    <label className="bam-label" htmlFor="occurredAt">
                      When (blank = now)
                    </label>
                    <input
                      id="occurredAt"
                      name="occurredAt"
                      type="datetime-local"
                      className="bam-input"
                    />
                  </div>
                  <div className="bam-field">
                    <label className="bam-label" htmlFor="note">
                      Note
                    </label>
                    <textarea
                      id="note"
                      name="note"
                      className="bam-input"
                      placeholder="What happened."
                    />
                  </div>
                  <button type="submit" className="bam-btn-primary">
                    Log event
                  </button>
                </form>
              </div>
            </Reveal>

            {/* ─── Danger zone ───────────────────────────────────────── */}
            <Reveal>
              <SectionTitle>Delete</SectionTitle>
              <p
                className="bam-body"
                style={{ marginBottom: "var(--bam-space-md)" }}
              >
                Removes the finding and its {finding.disclosureEvents.length}{" "}
                disclosure {finding.disclosureEvents.length === 1 ? "event" : "events"}.
                This cannot be undone.
              </p>
              <form action={deleteFinding}>
                <input type="hidden" name="findingId" value={finding.id} />
                <button type="submit" className="bam-btn-sm bam-btn-sm--danger">
                  Delete finding
                </button>
              </form>
            </Reveal>
          </div>
        </section>
      </main>
    </>
  );
}
