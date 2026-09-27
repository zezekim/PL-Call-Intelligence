"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

const START = "pestlaunch:navigation-start";

// A navigation that never lands (same URL, cancelled, failed) must not leave
// the bar hanging at 90%.
const GIVE_UP_MS = 8000;

/**
 * Start the bar for a navigation made in code (router.push). Pass the
 * destination so a push to the page already on screen doesn't start it.
 */
export function startProgress(href?: string) {
  if (href) {
    const url = new URL(href, window.location.href);
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;
  }
  window.dispatchEvent(new Event(START));
}

/**
 * A thin bar along the top of the window while moving between pages. It
 * starts when a link is followed, creeps forward while the next page loads,
 * and completes the moment the new route is on screen.
 */
export function RouteProgress() {
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}

function Bar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timers = useRef<number[]>([]);
  const running = useRef(false);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  function finish() {
    if (!running.current) return;
    running.current = false;
    clear();
    setWidth(100);
    timers.current.push(window.setTimeout(() => setVisible(false), 250));
    timers.current.push(window.setTimeout(() => setWidth(0), 550));
  }

  useEffect(() => {
    const start = () => {
      clear();
      running.current = true;
      setVisible(true);
      setWidth(8);
      // Ease towards 90% and wait there for the route to arrive.
      [[60, 30], [220, 55], [500, 72], [1000, 84], [2000, 90]].forEach(([delay, to]) =>
        timers.current.push(window.setTimeout(() => setWidth(to), delay)),
      );
      timers.current.push(window.setTimeout(finish, GIVE_UP_MS));
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
          event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      start();
    };
    window.addEventListener(START, start);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener(START, start);
      document.removeEventListener("click", onClick, true);
      clear();
    };
  }, []);

  // The new route rendered: finish, then fade out.
  useEffect(() => {
    finish();
  }, [pathname, search]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2.5px]"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 300ms ease" }}
    >
      <div
        className="h-full bg-accent shadow-[0_0_8px_rgba(0,113,227,0.55)]"
        style={{
          width: `${width}%`,
          transition: width === 0 ? "none" : "width 400ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />
    </div>
  );
}
