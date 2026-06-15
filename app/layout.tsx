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
  title: "Zorelan — Execution decision layer for AI actions",
  description:
    "Zorelan is a runtime execution decision layer for AI-driven actions. It evaluates a proposed action against your policy and returns ALLOW, REVIEW, or BLOCK before anything hits your backend.",
  openGraph: {
    title: "Zorelan — Execution decision layer for AI actions",
    description:
      "Zorelan is a runtime execution decision layer for AI-driven actions. It evaluates a proposed action against your policy and returns ALLOW, REVIEW, or BLOCK before anything hits your backend.",
    url: "https://zorelan.com",
    siteName: "Zorelan",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Zorelan — Execution decision layer for AI actions",
    description:
      "Zorelan is a runtime execution decision layer for AI-driven actions. It evaluates a proposed action against your policy and returns ALLOW, REVIEW, or BLOCK before anything hits your backend.",
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