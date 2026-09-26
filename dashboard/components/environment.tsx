"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "./ui";

export type Environment = "cloud" | "local";

const KEY = "pestlaunch.environment";
const ASK_KEY = "pestlaunch.askEnvironment";
const EVENT = "pestlaunch:environment";

export const ENGINE_FOR: Record<Environment, string> = { cloud: "deepgram", local: "local" };

export const ENVIRONMENTS: {
  value: Environment;
  label: string;
  summary: string;
  detail: string;
}[] = [
  {
    value: "cloud",
    label: "Cloud",
    summary: "Fastest. Recommended.",
    detail:
      "Deepgram transcribes the recording in seconds, with the best separation of rep and " +
      "customer. A typical call is scored and ready in about a minute.",
  },
  {
    value: "local",
    label: "Local",
    summary: "Private, but much slower.",
    detail:
      "The recording is transcribed on this server and never sent to a transcription " +
      "service. Much slower: transcription alone takes about a fifth of the call's length " +
      "(roughly 2 minutes for a 10-minute call) before scoring starts.",
  },
];

function read(): Environment {
  try {
    return window.localStorage.getItem(KEY) === "local" ? "local" : "cloud";
  } catch {
    return "cloud";
  }
}

export function useEnvironment() {
  const [env, setEnv] = useState<Environment>("cloud");

  useEffect(() => {
    setEnv(read());
    const onChange = () => setEnv(read());
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  const choose = useCallback((value: Environment) => {
    try {
      window.localStorage.setItem(KEY, value);
    } catch {
      /* storage unavailable: the choice lasts for this page only */
    }
    setEnv(value);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { env, choose };
}

/** Called after sign-in so the next page asks which environment to use. */
export function askForEnvironmentNext() {
  try {
    window.sessionStorage.setItem(ASK_KEY, "1");
  } catch {
    /* storage unavailable */
  }
}

export function EnvironmentPrompt() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(ASK_KEY) === "1") {
        window.sessionStorage.removeItem(ASK_KEY);
        setOpen(true);
      }
    } catch {
      /* storage unavailable */
    }
  }, []);
  return <EnvironmentDialog open={open} onClose={() => setOpen(false)} />;
}

export function EnvironmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { env, choose } = useEnvironment();
  return (
    <Modal open={open} onClose={onClose} title="Choose an environment">
      <p className="-mt-1 mb-4 text-[14px] leading-snug text-muted">
        This decides how call recordings you upload are transcribed. Scoring and coaching work
        the same way in both. You can switch at any time from the Calls page.
      </p>
      <div className="space-y-2.5">
        {ENVIRONMENTS.map((e) => (
          <button
            key={e.value}
            onClick={() => {
              choose(e.value);
              onClose();
            }}
            className={`w-full rounded-2xl border p-4 text-left transition-colors ${
              env === e.value ? "border-accent bg-accent-soft/50 ring-1 ring-accent" : "border-line hover:bg-panel"
            }`}
          >
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-[16px] font-semibold tracking-tightish">{e.label}</span>
              <span className={`text-[12px] font-medium ${e.value === "local" ? "text-warn" : "text-good"}`}>
                {e.summary}
              </span>
            </span>
            <span className="mt-1 block text-[14px] leading-snug text-ink/75">{e.detail}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
