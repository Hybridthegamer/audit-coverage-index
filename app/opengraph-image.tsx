import { ImageResponse } from "next/og";

import { getCoverageSummary } from "@/db/queries/public";
import { plural } from "@/lib/format";
import { OG, OG_CONTENT_TYPE, OG_SIZE, loadOgFonts } from "@/lib/og";

/**
 * Site-wide social card. Carries the same single number the landing page leads
 * with, so a shared link makes the argument before anyone clicks.
 *
 * Regenerated on the page's ISR cadence rather than per request — these are
 * expensive to render and the number moves hourly at most.
 */
export const runtime = "edge";
export const revalidate = 3600;
export const alt = "Audit Coverage Index";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  const summary = await getCoverageSummary();

  const headline = `${plural(summary.uncovered, "contract")} nobody actually reviewed.`;
  const footer = `${plural(summary.protocolCount, "PROTOCOL")} · ${plural(summary.total, "DEPLOYMENT")} TRACKED`;
  const eyebrow = "AUDIT COVERAGE INDEX";

  const fonts = await loadOgFonts(`${headline}${footer}${eyebrow}`);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: OG.bg,
          padding: "72px 80px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span
            style={{
              fontFamily: OG.mono,
              fontSize: 20,
              letterSpacing: 6,
              color: OG.cream40,
            }}
          >
            {eyebrow}
          </span>
          <span
            style={{
              fontFamily: OG.mono,
              fontSize: 20,
              letterSpacing: 6,
              color: OG.red,
            }}
          >
            UNCOVERED
          </span>
        </div>

        <div
          style={{
            display: "flex",
            fontFamily: OG.serif,
            fontSize: 104,
            lineHeight: 1.02,
            color: OG.cream,
            letterSpacing: -2,
            maxWidth: 960,
          }}
        >
          {headline}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            borderTop: `1px solid ${OG.border}`,
            paddingTop: 28,
          }}
        >
          <span
            style={{
              fontFamily: OG.mono,
              fontSize: 22,
              letterSpacing: 3,
              color: OG.cream60,
            }}
          >
            {footer}
          </span>
          <div style={{ display: "flex", width: 120, height: 6, background: OG.red }} />
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
