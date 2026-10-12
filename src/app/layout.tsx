import { Suspense } from "react";
import type { Metadata } from "next";
import localFont from "next/font/local";
import Sidebar from "@/components/Sidebar";
import Toasts from "@/components/Toasts";
import VoicePanel from "@/components/VoicePanel";
import MobileBar from "@/components/MobileBar";
import "./globals.css";

// Local variable fonts: Geist Sans + Mono, fully offline-ready
const geistSans = localFont({ src: "../fonts/Geist-Variable.woff2", weight: "100 900", variable: "--font-geist-sans" });
const jetbrainsMono = localFont({ src: "../fonts/GeistMono-Variable.woff2", weight: "100 900", variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  metadataBase: new URL("https://opendot-local.vercel.app"),
  title: {
    default: "OpenDot-Local — Free, Private & Open-Source Autonomous AI Agent Desktop",
    template: "%s | OpenDot-Local",
  },
  description:
    "OpenDot-Local is the 100% private, local-first autonomous AI agent that runs entirely on your machine. Powered by Ollama, SQLite FTS5 folder knowledge, MCP connectors, and local browser automation. No cloud needed.",
  applicationName: "OpenDot-Local",
  authors: [{ name: "Vedant Jadhav", url: "https://github.com/VedantJadhav701" }],
  creator: "Vedant Jadhav",
  publisher: "Vedant Jadhav",
  keywords: [
    "OpenDot",
    "opendot-local",
    "open dot local",
    "local AI agent",
    "autonomous AI agents",
    "Ollama agent",
    "private AI desktop",
    "MCP connectors",
    "local LLM agent",
    "AI assistant",
    "Vedant Jadhav",
    "offline AI",
    "browser automation",
  ],
  alternates: {
    canonical: "https://opendot-local.vercel.app",
  },
  openGraph: {
    title: "OpenDot-Local — Free, Private & Open-Source Autonomous AI Agent Desktop",
    description:
      "Open-source personal AI agents that work autonomously on your computer. 100% private and local with Ollama, SQLite FTS5, and browser automation.",
    url: "https://opendot-local.vercel.app",
    siteName: "OpenDot-Local",
    images: [
      {
        url: "/screenshots/app-overview.png",
        width: 1200,
        height: 630,
        alt: "OpenDot-Local autonomous agent dashboard",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenDot-Local — Private & Local-First Autonomous AI Agents",
    description:
      "100% private, local-first autonomous AI agents running on your machine with Ollama, SQLite FTS5, and local browser automation.",
    images: ["/screenshots/app-overview.png"],
    creator: "@VedantJadhav",
  },
  icons: {
    icon: [
      { url: "/assets/favicon.ico" },
      { url: "/assets/favicon.png", type: "image/png" },
    ],
    apple: "/assets/favicon.png",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: "google2cf97f98ea0dd64b",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "name": "OpenDot-Local",
      "applicationCategory": "ProductivityApplication",
      "operatingSystem": "Windows, macOS, Linux",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD",
      },
      "description":
        "Open-source personal AI agents that work autonomously on your computer. 100% private and local with Ollama, SQLite FTS5, and local browser automation.",
      "url": "https://opendot-local.vercel.app",
      "author": {
        "@type": "Person",
        "name": "Vedant Jadhav",
        "url": "https://github.com/VedantJadhav701",
      },
    },
    {
      "@type": "WebSite",
      "name": "OpenDot-Local",
      "url": "https://opendot-local.vercel.app",
      "description": "Open-source, private, local-first autonomous AI agents desktop application.",
      "author": {
        "@type": "Person",
        "name": "Vedant Jadhav",
      },
    },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${jetbrainsMono.variable} h-full`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="flex h-full overflow-hidden">
        <Suspense>
          <Sidebar />
        </Suspense>
        <main className="flex min-w-0 flex-1 flex-col bg-card">
          <Suspense>
            <MobileBar />
          </Suspense>
          {children}
        </main>
        <Toasts />
        <VoicePanel />
      </body>
    </html>
  );
}
