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
  title: "OpenDot-local",
  description: "Open-source personal AI agents that work on their own, on their own computers",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${jetbrainsMono.variable} h-full`}>
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
