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

export const metadata: Metadata = {
  title: {
    default: "AxlePoint Industrial",
    template: "%s | AxlePoint Industrial",
  },
  description:
    "Asset health and maintenance operations for heavy industry. Predictive failure risk scoring, work order management, and parts readiness in one platform.",
  robots: { index: false, follow: false },
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
