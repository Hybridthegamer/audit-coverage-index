import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Instrument_Serif, DM_Mono } from "next/font/google";
import "./globals.css";
import { GrainOverlay } from "@/components/GrainOverlay";
import { CustomCursor } from "@/components/CustomCursor";
import { SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site";

/**
 * Fonts self-host via next/font (no render-blocking CDN <link>, CSP-friendly
 * for step-3 ISR/OG) — same families/weights/italics the skill specifies.
 * Instrument Serif is the emotional voice; DM Mono is the clinical one. They
 * are exposed as the CSS vars globals.css resolves --bam-font-* against.
 */
const serif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bam-serif",
});

const mono = DM_Mono({
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bam-mono",
});

/**
 * `metadataBase` is what lets every route declare `alternates.canonical` and
 * `opengraph-image` as relative paths — Next resolves them against this origin.
 * It comes from lib/site.ts, so pointing the site at the custom domain is an
 * env change rather than an edit here.
 */
export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_TAGLINE,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: "/",
    title: SITE_NAME,
    description: SITE_TAGLINE,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_TAGLINE,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0D0D0D",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${mono.variable}`}>
      <body className="bam-root">
        {/* JS off → reveals can never fire, so force their content visible. */}
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important}`}</style>
        </noscript>

        {/* Global ambient effects — on every page (skill Step 5, Law #9). */}
        <GrainOverlay />
        <CustomCursor />

        {children}
      </body>
    </html>
  );
}
