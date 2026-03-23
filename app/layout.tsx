import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Zorelan — Verify AI before you trust it",
  description:
    "Zorelan compares multiple AI models, detects disagreement, and returns a trust-calibrated answer with a trust score, risk level, and recommended action.",
  openGraph: {
    title: "Zorelan — Verify AI before you trust it",
    description:
      "Zorelan compares multiple AI models, detects disagreement, and returns a trust-calibrated answer with a trust score, risk level, and recommended action.",
    url: "https://zorelan.com",
    siteName: "Zorelan",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Zorelan — Verify AI before you trust it",
    description:
      "Zorelan compares multiple AI models, detects disagreement, and returns a trust-calibrated answer with a trust score, risk level, and recommended action.",
  },
  metadataBase: new URL("https://zorelan.com"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Analytics />
      </body>
    </html>
  );
}