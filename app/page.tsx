import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/Reveal";
import { SiteNav } from "@/components/SiteNav";
import { StateMarker } from "@/components/StateMarker";
import type { CoverageState } from "@/lib/drift";
import { COVERAGE_MEANING } from "@/lib/format";
import { SITE_NAME } from "@/lib/site";

/**
 * Landing page — the door to the private research desk, and nothing else.
 *
 * Deliberately static: it reads no database. The counts that used to headline
 * this page came from `getCoverageSummary()`, which only counts PUBLISHED rows,
 * so with nothing published it rendered zeros — an empty product standing in
 * front of a full workspace. The four states below are a legend (what the words
 * mean), not data, so they need no query and no revalidate window.
 *
 * That also takes this page out of the public query surface entirely. `/index`
 * and `/protocols/[slug]` still exist and still read through
 * `db/queries/public.ts`; this page simply no longer points anyone at them.
 */

export const metadata: Metadata = {
  // `absolute` opts out of the layout title template — otherwise the home
  // page renders "Audit Coverage Index · Audit Coverage Index".
  title: { absolute: SITE_NAME },
  description:
    "A private audit research desk. An audit covers a commit, not a protocol — this is where the gap between the two gets measured.",
  alternates: { canonical: "/" },
};

const ORDER: CoverageState[] = ["uncovered", "drifted", "current", "unknown"];

/** What is behind the key, in the order the work actually runs. */
const DESK: { label: string; body: string }[] = [
  {
    label: "QUEUE",
    body: "The curated band, ranked. Money, audit presence, category and chain — filtered down to the protocols worth a week.",
  },
  {
    label: "TARGETS",
    body: "A pinned contract per protocol: deployment date, upgrade history, proxy authority, whether the source is even verified.",
  },
  {
    label: "FINDINGS",
    body: "What the review turned up, recorded against the deployment it belongs to. Pointers to proof — never exploit code.",
  },
  {
    label: "DISCLOSURE",
    body: "The timeline. Contacted, acknowledged, fixed. Dates, not adjectives.",
  },
];

export default function Home() {
  return (
    <>
      <SiteNav
        page="PRIVATE · ONE KEY HOLDER"
        action={{ href: "/workspace", label: "Enter workspace →" }}
      />

      <main className="bam-page">
        {/* ─── Hero ────────────────────────────────────────────────────── */}
        <section className="bam-pad-x bam-hero">
          <div className="bam-wide" style={{ width: "100%" }}>
            <Reveal>
              <p className="bam-eyebrow">
                PRIVATE AUDIT RESEARCH · ONE KEY HOLDER
              </p>
            </Reveal>

            <Reveal delay={80}>
              <h1 className="bam-display">
                Audit
                <br />
                Coverage
                <br />
                <em>Index.</em>
              </h1>
            </Reveal>

            <Reveal delay={200}>
              <p
                className="bam-body"
                style={{ maxWidth: "46ch", marginTop: "var(--bam-space-xl)" }}
              >
                An audit covers a commit, not a protocol. Every upgrade shipped
                after the auditors signed off is code that was never in scope.
                This is the desk where that gap gets worked — protocol by
                protocol, with the dates showing. Nothing here is published
                until it is finished.
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
                <Link href="/workspace" className="bam-btn-primary">
                  Enter the workspace
                </Link>
                <Link href="#desk" className="bam-btn-ghost">
                  What is in there
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
                  PRIVATE RESEARCH · NOT PUBLISHED
                </span>
                <span className="bam-marquee-item">
                  THE COMMITS ARE CONFIRMED BY HAND
                </span>
                <span className="bam-marquee-item">MEASURED, NOT SCORED</span>
              </span>
            ))}
          </div>
        </div>

        {/* ─── What is behind the key ──────────────────────────────────── */}
        <section
          id="desk"
          className="bam-pad-x"
          style={{
            paddingTop: "var(--bam-space-3xl)",
            paddingBottom: "var(--bam-space-2xl)",
          }}
        >
          <div className="bam-wide">
            <Reveal>
              <p className="bam-eyebrow">BEHIND THE KEY</p>
              <h2 className="bam-headline">The research desk.</h2>
              <p
                className="bam-body"
                style={{ maxWidth: "52ch", marginTop: "var(--bam-space-lg)" }}
              >
                One password, one holder, no accounts. Everything past the gate
                is working material: unfinished targets, unsent disclosures, and
                notes that stay wrong until somebody checks them.
              </p>
            </Reveal>

            <Reveal delay={120}>
              <div
                className="bam-data-list"
                style={{ marginTop: "var(--bam-space-2xl)" }}
              >
                {DESK.map((item) => (
                  <div className="bam-data-row" key={item.label}>
                    <span
                      className="bam-eyebrow"
                      style={{ minWidth: "11rem", flexShrink: 0 }}
                    >
                      {item.label}
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
                      {item.body}
                    </span>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* ─── The four states ─────────────────────────────────────────── */}
        <section
          id="method"
          className="bam-pad-x"
          style={{
            paddingTop: "var(--bam-space-2xl)",
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
                Coverage is a fact about git ancestry, not a rating. The desk
                resolves the most recent audit whose reviewed commit is an
                ancestor of what is deployed on-chain, then measures the days of
                code that landed after it. Both commits are confirmed by hand —
                no external source can supply either, so nothing here guesses.
                There is no weighting and no composite number to game.
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
                  An uncovered deployment is not a vulnerability, and nothing
                  here claims one. It says only that the code running on-chain
                  was never in an audit&apos;s scope. That is a measurable fact
                  about coverage — and establishing it, before a single word
                  goes out to a protocol team, is the whole job.
                </p>
              </div>
            </Reveal>

            <Reveal delay={280}>
              <div style={{ marginTop: "var(--bam-space-2xl)" }}>
                <Link href="/workspace" className="bam-btn-primary">
                  Enter the workspace
                </Link>
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
            <span className="bam-nav-brand">AUDIT COVERAGE INDEX · PRIVATE</span>
            <Link href="/workspace" className="bam-nav-link">
              ENTER THE WORKSPACE →
            </Link>
          </div>
        </footer>
      </main>
    </>
  );
}
