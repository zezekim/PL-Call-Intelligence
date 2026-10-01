"use client";

import Link from "next/link";
import { useEffect } from "react";

/** If a v2 page breaks, the owner sees a calm way forward, not a blank screen. */
export default function V2Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="card mx-auto mt-10 max-w-md px-6 py-12 text-center">
      <p className="text-[17px] font-semibold tracking-tightish">Something went wrong on this page</p>
      <p className="mx-auto mt-1.5 max-w-xs text-[14px] text-muted">Try again. If it keeps happening, go back to Today.</p>
      <div className="mt-5 flex justify-center gap-2">
        <button className="btn-primary" onClick={reset}>
          Try again
        </button>
        <Link href="/v2" className="btn-secondary">
          Go to Today
        </Link>
      </div>
    </div>
  );
}
