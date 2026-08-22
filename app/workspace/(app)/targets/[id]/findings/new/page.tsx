import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FindingForm } from "@/components/FindingForm";
import { Reveal } from "@/components/Reveal";
import { WorkspaceNav } from "@/components/WorkspaceNav";
import { createFinding } from "@/app/workspace/mutations";
import { getTarget } from "@/db/queries/workspace";
import { chainLabel, truncateAddress } from "@/lib/format";

/**
 * New finding, filed against one deployment. On submit, createFinding inserts
 * the row and redirects to the finding editor. force-dynamic: private, uncached.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "New finding",
};

export default async function NewFindingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const deploymentId = Number(id);
  if (!Number.isInteger(deploymentId) || deploymentId <= 0) notFound();

  const target = await getTarget(deploymentId);
  if (!target) notFound();

  return (
    <>
      <WorkspaceNav page={target.protocolName.toUpperCase()} />

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
                  href={`/workspace/targets/${deploymentId}`}
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  ← {target.protocolName.toUpperCase()}
                </Link>
              </p>
              <h1 className="bam-headline">New finding.</h1>
              <p
                className="bam-body"
                style={{ maxWidth: "52ch", marginTop: "var(--bam-space-md)" }}
              >
                Against {target.protocolName} — {chainLabel(target.chain)} ·{" "}
                {truncateAddress(target.addressOrProgramId)}. The disclosure
                timeline opens once the finding exists.
              </p>
            </Reveal>

            <Reveal delay={80}>
              <div style={{ marginTop: "var(--bam-space-2xl)" }}>
                <FindingForm
                  action={createFinding}
                  deploymentId={deploymentId}
                  initial={{
                    title: "",
                    severity: null,
                    immunefiClass: null,
                    fundsAtRiskUsd: null,
                    status: "draft",
                    summary: null,
                    rootCause: null,
                    attackPath: null,
                    preconditions: null,
                    impact: null,
                    recommendedFix: null,
                    pocRef: null,
                    // Sensible default: a finding filed from a drifted/uncovered
                    // target is, by construction, in post-audit code.
                    inPostAuditCode:
                      target.coverageState === "drifted" ||
                      target.coverageState === "uncovered",
                  }}
                  submitLabel="Create finding"
                />
              </div>
            </Reveal>
          </div>
        </section>
      </main>
    </>
  );
}
