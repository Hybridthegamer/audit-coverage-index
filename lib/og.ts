/**
 * Shared plumbing for the OG image routes (`opengraph-image.tsx`).
 *
 * Fonts are the awkward part. Satori — the renderer behind next/og — parses
 * TTF/OTF/WOFF but NOT WOFF2, while Google Fonts content-negotiates the format
 * from the User-Agent. The negotiation is genuinely counterintuitive:
 *
 *   modern Chrome/Firefox UA  -> WOFF2  (Satori throws)
 *   MSIE 6-ish UA             -> EOT    (Satori throws "Unsupported OpenType
 *                                        signature" — an EOT starts with a
 *                                        little-endian size field, not a tag)
 *   Android 2.2 / unknown UA  -> TTF    (what we want)
 *
 * So we ask as Android 2.2 on both the CSS request and the font-file request —
 * the format is decided on the file fetch, not the stylesheet fetch, so the
 * header has to be on both.
 *
 * Everything here is best-effort: on any failure we return no fonts and
 * next/og falls back to its bundled default face. A social card in the wrong
 * font is a blemish; a route that 500s because Google Fonts had a bad minute
 * is an outage. Results are ISR-cached with the image, so this runs rarely.
 */

/** UA old enough to predate WOFF and EOT, so Google serves plain TTF. */
const TTF_UA =
  "Mozilla/5.0 (Linux; U; Android 2.2; en-us; Nexus One Build/FRF91) " +
  "AppleWebKit/533.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/533.1";

/**
 * Glyphs always requested alongside the page's own text. Google subsets to
 * exactly the characters asked for, and a character missing from the subset
 * renders blank — so the common set is pinned rather than inferred.
 */
const ALWAYS_INCLUDE =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" +
  " .,:;!?'\"()[]{}/\\|-–—_+=*&%$#@~^<>·↗←→";

/** Font container tags Satori can actually parse. */
const SUPPORTED_MAGIC = new Set([
  0x00010000, // TrueType outlines
  0x74727565, // 'true'
  0x4f54544f, // 'OTTO' — CFF/OpenType
  0x774f4646, // 'wOFF'
]);

export interface OgFont {
  name: string;
  data: ArrayBuffer;
  weight: 400;
  style: "normal";
}

/** Reject WOFF2/EOT/HTML-error-page bytes before they reach Satori. */
function isParseableFont(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false;
  return SUPPORTED_MAGIC.has(new DataView(buf).getUint32(0, false));
}

async function loadGoogleFont(
  family: string,
  text: string,
): Promise<OgFont | null> {
  try {
    const url =
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}` +
      `&text=${encodeURIComponent(text)}`;

    const cssRes = await fetch(url, { headers: { "User-Agent": TTF_UA } });
    if (!cssRes.ok) return null;

    const src = /src:\s*url\(([^)]+)\)/.exec(await cssRes.text())?.[1];
    if (!src) return null;

    // The format is negotiated on THIS request, so the UA matters here too.
    const fontRes = await fetch(src, { headers: { "User-Agent": TTF_UA } });
    if (!fontRes.ok) return null;

    const data = await fontRes.arrayBuffer();
    if (!isParseableFont(data)) return null;

    return { name: family, data, weight: 400, style: "normal" };
  } catch {
    return null;
  }
}

/**
 * Load the two design-system faces, subset to the glyphs actually needed.
 * Returns whatever succeeded — possibly an empty array.
 */
export async function loadOgFonts(text: string): Promise<OgFont[]> {
  const subset = Array.from(new Set(`${text}${ALWAYS_INCLUDE}`)).join("");
  const results = await Promise.all([
    loadGoogleFont("Instrument Serif", subset),
    loadGoogleFont("DM Mono", subset),
  ]);
  return results.filter((f): f is OgFont => f !== null);
}

/** The palette, duplicated here because Satori cannot read CSS custom props. */
export const OG = {
  bg: "#0D0D0D",
  cream: "#F0EBE1",
  cream60: "rgba(240, 235, 225, 0.60)",
  cream40: "rgba(240, 235, 225, 0.40)",
  cream20: "rgba(240, 235, 225, 0.20)",
  border: "rgba(240, 235, 225, 0.10)",
  red: "#C8003C",
  serif: "Instrument Serif, Georgia, serif",
  mono: "DM Mono, ui-monospace, monospace",
} as const;

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";
