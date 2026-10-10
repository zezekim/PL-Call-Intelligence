import type { Metadata } from "next";
import Link from "next/link";
import { AppMark } from "@/components/brand";

export const metadata: Metadata = { title: "Not found · PestLaunch" };

export default function NotFound() {
  return (
    <div className="fade-in flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <AppMark size={64} />
      <h1 className="mt-6 text-[30px] font-bold tracking-title">This page doesn&apos;t exist</h1>
      <p className="mt-2 max-w-sm text-[18px] text-ink/75">The link may be old, or the call may have been deleted.</p>
      <Link href="/v2" className="btn-primary mt-7 min-h-[56px] px-8 text-[18px] hover:no-underline">
        Go to Today
      </Link>
    </div>
  );
}
