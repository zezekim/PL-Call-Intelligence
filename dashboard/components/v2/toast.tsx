"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertIcon, CheckIcon } from "@/components/icons";

/**
 * A quiet confirmation at the bottom of the window, like Mail's "Moved to
 * Trash · Undo": the owner sees that a tap worked, and can take it back.
 */
export interface ToastInput {
  message: string;
  tone?: "done" | "error";
  /** Shown as a button; the toast closes once it runs. */
  undo?: () => void | Promise<void>;
}

type Show = (t: ToastInput) => void;

const ToastContext = createContext<Show>(() => undefined);

export const useToast = () => useContext(ToastContext);

const VISIBLE_MS = 5000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<(ToastInput & { id: number }) | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback<Show>((t) => {
    window.clearTimeout(timer.current);
    setToast({ ...t, id: Date.now() });
    timer.current = window.setTimeout(() => setToast(null), t.undo ? VISIBLE_MS + 2000 : VISIBLE_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const Icon = toast?.tone === "error" ? AlertIcon : CheckIcon;
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex justify-center px-4 print:hidden"
        role="status"
        aria-live="polite"
      >
        {toast && (
          <div
            key={toast.id}
            className="animate-toast-in pointer-events-auto flex max-w-[460px] items-center gap-3 rounded-full bg-ink/90 py-2 pl-4 pr-2 text-[14px] text-canvas shadow-pop backdrop-blur-xl"
          >
            <Icon className="h-4 w-4 shrink-0 opacity-80" />
            <span className="min-w-0 flex-1 truncate">{toast.message}</span>
            {toast.undo ? (
              <button
                className="shrink-0 rounded-full px-3 py-1 font-semibold text-canvas hover:bg-canvas/15"
                onClick={async () => {
                  const undo = toast.undo!;
                  close();
                  await undo();
                }}
              >
                Undo
              </button>
            ) : (
              <span className="w-2" aria-hidden />
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

/** Plain words for a failed request; the server's wording is for developers. */
export function failMessage(): string {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return offline ? "You're offline. Try again when you're connected." : "That didn't work. Please try again.";
}
