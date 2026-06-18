import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { ParadigmBanner } from "@/components/paradigm-banner";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

const SITE_URL = "https://axlepoint.projectnexuscode.org";
const SITE_DESCRIPTION =
  "Asset health and maintenance operations for heavy industry. Predictive failure risk scoring, work order management, and parts readiness in one platform.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "AxlePoint Industrial",
    template: "%s | AxlePoint Industrial",
  },
  description: SITE_DESCRIPTION,
  robots: { index: false, follow: false },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "AxlePoint Industrial",
    title: "AxlePoint Industrial",
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
    images: [
      {
        url: "/og-default.png",
        width: 1200,
        height: 630,
        alt: "AxlePoint Industrial, a Paradigm Coding Solutions portfolio demo.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AxlePoint Industrial",
    description: SITE_DESCRIPTION,
    images: ["/og-default.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${plexSans.variable} ${plexMono.variable} font-sans antialiased`}
      >
        {children}
        <ParadigmBanner />
      </body>
    </html>
  );
}
