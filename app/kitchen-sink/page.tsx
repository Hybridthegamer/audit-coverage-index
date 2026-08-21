import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import type { CoverageState } from "@/lib/drift";

/**
 * Design-system kitchen sink — the acceptance surface for the bam83 foundation
 * (build step 2). Not a product route: it exists to eyeball tokens, fonts, the
 * grain, the reveal primitive, and — the whole point of the split — the two
 * surfaces side by side. The real /, /index, and /protocols/[slug] ship later.
 */
export const metadata: Metadata = {
  title: "bam83 · kitchen sink",
  robots: { index: false, follow: false },
};

/** Sample rows for the dense surface — every coverage state, incl. one red. */
const SAMPLE: {
  protocol: string;
  chain: string;
  audited: string;
  state: CoverageState;
  drift: string;
}[] = [
  { protocol: "Aave v3", chain: "Ethereum", audited: "2024-11-02", state: "current", drift: "0" },
  { protocol: "Morpho Blue", chain: "Base", audited: "2024-08-19", state: "drifted", drift: "63" },
  { protocol: "Silo Finance", chain: "Arbitrum", audited: "2024-06-30", state: "drifted", drift: "118" },
  { protocol: "Kwenta Perps", chain: "Optimism", audited: "—", state: "uncovered", drift: "204" },
  { protocol: "Reserve RTokens", chain: "Ethereum", audited: "2024-10-14", state: "current", drift: "0" },
  { protocol: "Sommelier Cellar", chain: "Ethereum", audited: "—", state: "unknown", drift: "—" },
];

const STATE_LABEL: Record<CoverageState, string> = {
  current: "Current",
  drifted: "Drifted",
  uncovered: "Uncovered",
  unknown: "Unknown",
};

export default function KitchenSink() {
  return (
    <>
      <nav className="bam-nav">
        <span className="bam-nav-brand">AUDIT COVERAGE INDEX · BAM83</span>
        <span className="bam-nav-page">KITCHEN SINK · DESIGN FOUNDATION</span>
      </nav>

      <div className="bam-marquee-wrap">
        <div className="bam-marquee-track">
          {[0, 1].map((dup) => (
            <span key={dup} style={{ display: "flex" }} aria-hidden={dup === 1}>
              <span className="bam-marquee-item">INSTRUMENT SERIF · THE EMOTIONAL VOICE</span>
              <span className="bam-marquee-item bam-marquee-item--accent">RED = DRIFTED FROM EVERY AUDIT</span>
              <span className="bam-marquee-item">DM MONO · THE CLINICAL VOICE</span>
              <span className="bam-marquee-item">#0D0D0D · #F0EBE1 · #C8003C</span>
            </span>
          ))}
        </div>
      </div>

      {/* ─── EDITORIAL SURFACE ─────────────────────────────────────────── */}
      <main className="bam-wide bam-pad-x" style={{ paddingTop: "var(--bam-space-3xl)" }}>
        <Reveal>
          <p className="bam-eyebrow">DESIGN SYSTEM · SURFACE ONE · EDITORIAL</p>
          <h1 className="bam-display">
            Code the auditors <em>never</em> saw.
          </h1>
        </Reveal>

        <Reveal delay={120}>
          <p className="bam-body bam-mid" style={{ marginTop: "var(--bam-space-lg)", marginLeft: 0 }}>
            The cinematic surface: fluid display type, the serif voice, one
            reveal per block. Reserved for the catalog hero and protocol detail
            pages — narrative, not data.
          </p>
        </Reveal>

        <Reveal delay={200}>
          <div style={{ display: "flex", gap: "var(--bam-space-md)", flexWrap: "wrap", marginTop: "var(--bam-space-xl)" }}>
            <a className="bam-btn-primary" href="#dense">VIEW THE INDEX</a>
            <a className="bam-btn-ghost" href="#components">SEE COMPONENTS</a>
          </div>
        </Reveal>

        <div className="bam-divider" style={{ marginTop: "var(--bam-space-2xl)" }} />

        <Reveal>
          <div id="components" className="bam-split">
            <div>
              <p className="bam-eyebrow">DISPLAY FIGURE</p>
              <p className="bam-display" style={{ color: "var(--bam-red)" }}>204</p>
              <p className="bam-body" style={{ marginTop: "var(--bam-space-sm)" }}>
                Days of drift on the single uncovered deployment. The one place
                red earns its keep on this page.
              </p>
            </div>

            <div>
              <p className="bam-eyebrow">DATA LIST</p>
              <div className="bam-data-list">
                <div className="bam-data-row">
                  <span className="bam-data-key">PROTOCOL</span>
                  <span className="bam-data-val bam-data-val--serif">Kwenta Perps</span>
                </div>
                <div className="bam-data-row">
                  <span className="bam-data-key">DEPLOYED COMMIT</span>
                  <span className="bam-data-val">9f3c1ae</span>
                </div>
                <div className="bam-data-row">
                  <span className="bam-data-key">COVERAGE</span>
                  <span className="bam-data-val">No covering audit</span>
                </div>
              </div>

              <div style={{ display: "flex", gap: "var(--bam-space-sm)", marginTop: "var(--bam-space-lg)", flexWrap: "wrap" }}>
                <span className="bam-badge bam-badge--pending">PENDING</span>
                <span className="bam-badge bam-badge--confirmed">CONFIRMED</span>
                <span className="bam-badge bam-badge--record">RECORD</span>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal>
          <div className="bam-split" style={{ marginTop: "var(--bam-space-2xl)" }}>
            <div className="bam-field" style={{ marginBottom: 0 }}>
              <label className="bam-label" htmlFor="ks-input">SEARCH PROTOCOLS</label>
              <input className="bam-input" id="ks-input" type="text" placeholder="ENTER A PROTOCOL NAME" />
            </div>
            <div className="bam-notice">
              <p className="bam-notice-label">NOTICE</p>
              <p className="bam-notice-body">
                Red is reserved. It means one thing on the whole site: a
                deployment that drifted from every audit.
              </p>
            </div>
          </div>
        </Reveal>

        <div className="bam-divider" style={{ marginTop: "var(--bam-space-2xl)" }} />
      </main>

      {/* ─── DENSE SURFACE ─────────────────────────────────────────────── */}
      <section id="dense" data-surface="dense" className="bam-pad-x" style={{ paddingTop: "var(--bam-space-2xl)", paddingBottom: "var(--bam-space-3xl)" }}>
        <div className="bam-wide">
          <p className="bam-eyebrow">DESIGN SYSTEM · SURFACE TWO · DENSE / INDEX</p>
          <p className="bam-body" style={{ marginBottom: "var(--bam-space-lg)" }}>
            The scannable surface: mono-first, tabular, one reveal on the whole
            table. Monochrome cream — so the single red row is the only thing
            your eye lands on across 200+ rows.
          </p>

          <Reveal>
            <div style={{ overflowX: "auto" }}>
              <table className="bam-table">
                <thead>
                  <tr>
                    <th>Protocol</th>
                    <th>Chain</th>
                    <th>Last Audit</th>
                    <th>Coverage</th>
                    <th style={{ textAlign: "right" }}>Drift (days)</th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE.map((row) => (
                    <tr key={`${row.protocol}-${row.chain}`}>
                      <td className="bam-cell-name">{row.protocol}</td>
                      <td>{row.chain}</td>
                      <td>{row.audited}</td>
                      <td>
                        <span className={`bam-state bam-state--${row.state}`}>
                          {STATE_LABEL[row.state]}
                        </span>
                      </td>
                      <td className="bam-cell-num">{row.drift}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
