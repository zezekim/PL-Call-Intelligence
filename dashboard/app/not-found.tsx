import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Not found · PestLaunch" };

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="text-[13px] font-medium text-muted">404</p>
      <h1 className="mt-2 text-[28px] font-semibold tracking-title">This page doesn&apos;t exist</h1>
      <p className="mt-2 max-w-sm text-[15px] text-muted">
        The link may be old, or the call may have been deleted.
      </p>
      <Link href="/calls" className="btn-primary mt-6">
        Go to Calls
      </Link>
    </div>
  );
}
