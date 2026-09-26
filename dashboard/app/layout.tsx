import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Shell } from "@/components/shell";

export const metadata: Metadata = {
  title: "Calls · PestLaunch",
  description: "Call intelligence for pest control teams",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#eef0f4",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
