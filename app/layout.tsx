import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ALONE SONG — Web DAW",
  description:
    "ALONE SONG — a browser-based Digital Audio Workstation for multitrack recording, mixing and mastering.",
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font --
            This rule targets the Pages Router, where a <link> outside
            pages/_document.js only loads for a single page. app/layout.tsx
            is the App Router equivalent of _document.js: it wraps every
            route, so the font persists across navigation as intended. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-display">{children}</body>
    </html>
  );
}
