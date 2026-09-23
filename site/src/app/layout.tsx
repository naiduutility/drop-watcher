import type { ReactNode } from "react";
import { Archivo } from "next/font/google";

import "./globals.css";

/**
 * Archivo at the three weights the system uses. Self-hosted by next/font, so
 * there is no render-blocking request to Google and no layout shift when it
 * lands — which matters when the first thing someone does on this page is read
 * whether a watch is healthy.
 */
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "600", "800"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata = {
  title: "Drop Watcher",
  description: "Know the minute tickets drop.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f2f2" },
    { media: "(prefers-color-scheme: dark)", color: "#171514" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
