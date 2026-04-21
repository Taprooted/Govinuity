import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SidebarNav } from "./components/ui";
import { currentMode, describeMode } from "../lib/deployment-mode";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Govinuity",
  description: "Governed continuity for human-agent work.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const mode = currentMode();
  const deploymentMode = mode === "invalid" ? "local" : mode;
  const modeSummary = describeMode(deploymentMode);

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="h-full">
        <div className="flex min-h-screen bg-[var(--background)]">
          <SidebarNav mode={deploymentMode} />
          <main className="min-w-0 flex-1">
            <div className="mx-auto max-w-6xl px-6 py-8">
              <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">{modeSummary.label}</p>
                <p className="mt-1 text-sm text-[var(--muted)]">{modeSummary.detail}</p>
              </div>
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
