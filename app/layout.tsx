import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Zorelan — Think once. Ask every AI.",
  description: "Structure your thinking, then run it across multiple AI models at once. Compare answers and combine the best insights.",
  openGraph: {
    title: "Zorelan — Think once. Ask every AI.",
    description: "Structure your thinking, then run it across multiple AI models at once. Compare answers and combine the best insights.",
    url: "https://zorelan.vercel.app",
    siteName: "Zorelan",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Zorelan — Think once. Ask every AI.",
    description: "Structure your thinking, then run it across multiple AI models at once. Compare answers and combine the best insights.",
  },
  metadataBase: new URL("https://zorelan.vercel.app"),
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
      </body>
    </html>
  );
}