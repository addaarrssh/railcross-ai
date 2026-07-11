import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
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

export const viewport: Viewport = {
  themeColor: "#1a73e8",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "railcross.local";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const siteUrl = `${protocol}://${host}`;
  const title = "RailCross — Railway-Crossing-Aware Navigation";
  const description =
    "A route-planning concept that combines traffic signals, community verification, and delay prediction around railway crossings.";

  return {
    title,
    description,
    metadataBase: new URL(siteUrl),
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/favicon.svg" },
    manifest: "/manifest.json",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "RailCross",
    },
    openGraph: {
      title,
      description,
      url: siteUrl,
      type: "website",
      images: [{ url: `${siteUrl}/og.png`, width: 1200, height: 630, alt: "RailCross route decision concept" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${siteUrl}/og.png`],
    },
  };
}

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
