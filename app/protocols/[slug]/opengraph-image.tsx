import { ImageResponse } from "next/og";

import { getProtocolBySlug } from "@/db/queries/public";
import { COVERAGE_LABEL, chainLabel, formatDrift, plural } from "@/lib/format";
import { OG, OG_CONTENT_TYPE, OG_SIZE, loadOgFonts } from "@/lib/og";

/**
 * Per-protocol social card: the protocol name, and a strip of its deployments
 * with each one's coverage state. Red appears here under exactly the same rule
 * as everywhere else — only for `uncovered`.
 *
 * An unpublished slug renders a neutral fallback card rather than throwing,
 * because Next still asks for the image on the 404 path.
 */
export const runtime = "edge";
export const revalidate = 3600;
export const alt = "Audit coverage for this protocol";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

const STATE_COLOR: Record<string, string> = {
  uncovered: OG.red,
  drifted: OG.cream,
  current: OG.cream40,
  unknown: OG.cream20,
};

export default async function Image({
  params,
}: {
  params: { slug: string };
}) {
  const protocol = await getProtocolBySlug(params.slug);

  if (!protocol) {
    const fonts = await loadOgFonts("Audit Coverage Index");
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: OG.bg,
            fontFamily: OG.serif,
            fontSize: 72,
            color: OG.cream,
          }}
        >
          Audit Coverage Index
        </div>
      ),
      { ...size, fonts: fonts.length ? fonts : undefined },
    );
  }

  const uncovered = protocol.deployments.filter(
    (d) => d.coverageState === "uncovered",
  ).length;

  // Only the first five fit on a card without the type collapsing.
  const shown = protocol.deployments.slice(0, 5);
  const overflow = protocol.deployments.length - shown.length;

  const summaryLine =
    uncovered > 0
      ? `${uncovered} OF ${plural(protocol.deployments.length, "DEPLOYMENT")} UNCOVERED`
      : `${plural(protocol.deployments.length, "DEPLOYMENT")} · ${plural(protocol.audits.length, "AUDIT")} ON RECORD`;

  const glyphs = [
    protocol.name,
    summaryLine,
    "AUDIT COVERAGE INDEX",
    ...shown.map(
      (d) =>
        `${chainLabel(d.chain)}${COVERAGE_LABEL[d.coverageState]}${formatDrift(d.driftDays)}d`,
    ),
    overflow > 0 ? `+${overflow} more` : "",
  ].join("");

  const fonts = await loadOgFonts(glyphs);

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
          padding: "64px 80px",
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
            AUDIT COVERAGE INDEX
          </span>
          <span
            style={{
              fontFamily: OG.mono,
              fontSize: 20,
              letterSpacing: 4,
              color: uncovered > 0 ? OG.red : OG.cream40,
            }}
          >
            {summaryLine}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            fontFamily: OG.serif,
            fontSize: 116,
            lineHeight: 1,
            color: OG.cream,
            letterSpacing: -3,
          }}
        >
          {protocol.name}
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {shown.map((d) => (
            <div
              key={d.deploymentId}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderTop: `1px solid ${OG.border}`,
                padding: "14px 0",
                fontFamily: OG.mono,
                fontSize: 24,
                color: OG.cream60,
              }}
            >
              <span style={{ display: "flex", alignItems: "center" }}>
                <div
                  style={{
                    display: "flex",
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    marginRight: 18,
                    background: STATE_COLOR[d.coverageState] ?? OG.cream20,
                  }}
                />
                {chainLabel(d.chain)}
              </span>
              <span
                style={{
                  color: STATE_COLOR[d.coverageState] ?? OG.cream20,
                  letterSpacing: 3,
                }}
              >
                {COVERAGE_LABEL[d.coverageState].toUpperCase()}
                {d.driftDays !== null && d.driftDays > 0
                  ? ` · ${formatDrift(d.driftDays)}d`
                  : ""}
              </span>
            </div>
          ))}

          {overflow > 0 ? (
            <span
              style={{
                fontFamily: OG.mono,
                fontSize: 20,
                color: OG.cream20,
                paddingTop: 12,
              }}
            >
              +{overflow} more
            </span>
          ) : null}
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
