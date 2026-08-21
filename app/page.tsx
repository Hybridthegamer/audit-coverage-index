import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/Reveal";
import { SiteNav } from "@/components/SiteNav";
import { StateMarker } from "@/components/StateMarker";
import { getCoverageSummary } from "@/db/queries/public";
import type { CoverageState } from "@/lib/drift";
import { COVERAGE_MEANING, formatTvl, plural } from "@/lib/format";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

/**
 * Landing page — the argument, not the data. One number carries it: how many
 * deployed contracts are running code that is downstream of every audit their
 * protocol ever published. The table itself lives at /index.
 *
 * ISR: revalidated hourly. Coverage changes when a protocol upgrades or a new
 * audit lands — neither is minute-scale, and the ingest worker (step 5) will
 * revalidate on demand when it writes.
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  // `absolute` opts out of the layout title template — otherwise the home
  // page renders "Audit Coverage Index · Audit Coverage Index".
  title: { absolute: SITE_NAME },
  description: SITE_TAGLINE,
  alternates: { canonical: "/" },
};

const ORDER: CoverageState[] = ["uncovered", "drifted", "current", "unknown"];

export default async function Home() {
  const summary = await getCoverageSummary();

  return (
    <>
      <SiteNav page="COVERAGE MEASUREMENT" />

      <main className="bam-page">
        {/* ─── Hero ────────────────────────────────────────────────────── */}
        <section className="bam-pad-x bam-hero">
          <div className="bam-wide" style={{ width: "100%" }}>
            <Reveal>
              <p className="bam-eyebrow">
                {plural(summary.protocolCount, "PROTOCOL")} ·{" "}
                {plural(summary.total, "DEPLOYMENT")} TRACKED
              </p>
            </Reveal>

            <Reveal delay={80}>
              <h1 className="bam-display">
                {plural(summary.uncovered, "contract")}
                <br />
                nobody <em>actually</em>
                <br />
                reviewed.
              </h1>
            </Reveal>

            <Reveal delay={200}>
              <p
                className="bam-body"
                style={{ maxWidth: "44ch", marginTop: "var(--bam-space-xl)" }}
              >
                An audit covers a commit, not a protocol. Every upgrade shipped
                after the auditors signed off is code that was never in scope.
                This index measures the gap — publicly, per deployment, with the
                dates showing.
              </p>
            </Reveal>

            <Reveal delay={300}>
              <div
                style={{
                  display: "flex",
                  gap: "var(--bam-space-md)",
                  flexWrap: "wrap",
                  marginTop: "var(--bam-space-xl)",
                }}
              >
                <Link href="/index" className="bam-btn-primary">
                  Read the index
                </Link>
                <Link href="#method" className="bam-btn-ghost">
                  How it is measured
                </Link>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ─── Marquee ─────────────────────────────────────────────────── */}
        <div className="bam-marquee-wrap">
          <div className="bam-marquee-track">
            {[0, 1].map((dup) => (
              <span key={dup} style={{ display: "flex" }} aria-hidden={dup === 1}>
                <span className="bam-marquee-item">
                  AN AUDIT COVERS A COMMIT — NOT A PROTOCOL
                </span>
                <span className="bam-marquee-item bam-marquee-item--accent">
                  {plural(summary.uncovered, "UNCOVERED DEPLOYMENT")}
                </span>
                <span className="bam-marquee-item">
                  {formatTvl(summary.uncoveredTvlUsd)} SITTING ON UNREVIEWED CODE
                </span>
                <span className="bam-marquee-item">
                  MEASURED, NOT SCORED
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* ─── The four states ─────────────────────────────────────────── */}
        <section
          id="method"
          className="bam-pad-x"
          style={{
            paddingTop: "var(--bam-space-3xl)",
            paddingBottom: "var(--bam-space-3xl)",
          }}
        >
          <div className="bam-wide">
            <Reveal>
              <p className="bam-eyebrow">THE MEASUREMENT</p>
              <h2 className="bam-headline">Four states. No score.</h2>
              <p
                className="bam-body"
                style={{ maxWidth: "52ch", marginTop: "var(--bam-space-lg)" }}
              >
                Coverage is a fact about git ancestry, not a rating. We resolve
                the most recent audit whose reviewed commit is an ancestor of
                what is deployed on-chain, then measure the days of code that
                landed after it. There is no weighting and no composite number
                to game.
              </p>
            </Reveal>

            <Reveal delay={120}>
              <div
                className="bam-data-list"
                style={{ marginTop: "var(--bam-space-2xl)" }}
              >
                {ORDER.map((state) => (
                  <div className="bam-data-row" key={state}>
                    <span style={{ minWidth: "11rem", flexShrink: 0 }}>
                      <StateMarker state={state} />
                    </span>
                    <span
                      className="bam-body"
                      style={{
                        flex: 1,
                        textAlign: "left",
                        fontSize: "0.8rem",
                        lineHeight: 1.6,
                      }}
                    >
                      {COVERAGE_MEANING[state]}
                    </span>
                    <span
                      className="bam-data-val--serif"
                      style={{ minWidth: "3rem", textAlign: "right" }}
                    >
                      {summary[state]}
                    </span>
                  </div>
                ))}
              </div>
            </Reveal>

            <Reveal delay={200}>
              <div
                className="bam-notice"
                style={{ marginTop: "var(--bam-space-2xl)" }}
              >
                <p className="bam-notice-label">On what this is not</p>
                <p className="bam-notice-body">
                  An uncovered deployment is not a vulnerability, and this index
                  does not claim one. It says only that the code running on-chain
                  was never in an audit&apos;s scope. That is a measurable fact
                  about coverage, and it is the fact the industry keeps not
                  writing down.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ─── Footer ──────────────────────────────────────────────────── */}
        <footer
          className="bam-pad-x"
          style={{
            borderTop: "1px solid var(--bam-border)",
            paddingTop: "var(--bam-space-xl)",
            paddingBottom: "var(--bam-space-xl)",
          }}
        >
          <div
            className="bam-wide"
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "var(--bam-space-lg)",
              flexWrap: "wrap",
            }}
          >
            <span className="bam-nav-brand">AUDIT COVERAGE INDEX</span>
            <Link
              href="/index"
              className="bam-nav-page"
              style={{ textDecoration: "none" }}
            >
              THE INDEX →
            </Link>
          </div>
        </footer>
      </main>
    </>
  );
}
