import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ErrorReporter } from "@/components/error-reporter";
import { Shell } from "@/components/shell";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Calls · PestLaunch",
  description: "Call intelligence for pest control teams",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#f5f5f7",
};

// Applies the theme before first paint, so the page never flashes the other one.
// Light unless this browser chose Dark, or Automatic (follow the device).
const THEME_SCRIPT = `try{var d=document.documentElement.dataset,t=localStorage.getItem("theme");if(t==="system")delete d.theme;else d.theme=t==="dark"?"dark":"light"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ErrorReporter />
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
