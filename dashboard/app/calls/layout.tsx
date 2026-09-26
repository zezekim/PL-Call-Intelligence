"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, type CallRow } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { CallsContext } from "@/components/calls-context";
import {
  ENGINE_FOR,
  ENVIRONMENTS,
  EnvironmentDialog,
  useEnvironment,
} from "@/components/environment";
import { RefreshIcon, UploadIcon } from "@/components/icons";
import { ErrorNote, Modal, Segmented, Spinner } from "@/components/ui";

type Range = "7" | "30" | "all";

const TABS = [
  { href: "/calls", label: "Overview" },
  { href: "/calls/pipeline", label: "Pipeline" },
  { href: "/calls/reps", label: "Reps" },
  { href: "/calls/log", label: "Call Log" },
];

const RANGE_KEY = "pestlaunch.range";

export default function CallsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [range, setRange] = useState<Range>("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const { env } = useEnvironment();
  const [asOf, setAsOf] = useState(() => new Date().toISOString());

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(RANGE_KEY) as Range | null;
      if (saved === "7" || saved === "30" || saved === "all") setRange(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const changeRange = (value: Range) => {
    setRange(value);
    try {
      window.localStorage.setItem(RANGE_KEY, value);
    } catch {
      /* storage unavailable */
    }
  };

  const days = range === "all" ? null : Number(range);
  const query = useCallback(
    (path: string) => (days ? `${path}${path.includes("?") ? "&" : "?"}days=${days}` : path),
    [days],
  );

  const isTab = TABS.some((t) => t.href === pathname);
  const active = TABS.find((t) => t.href === pathname)?.href;

  return (
    <CallsContext.Provider value={{ days, refreshKey, query }}>
      {isTab && (
        <div className="mb-8">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div>
              <h1 className="large-title">Calls</h1>
              <p className="footnote mt-1.5">
                {range === "all" ? "All calls" : `Last ${range} days`} · updated {dateTime(asOf)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setEnvOpen(true)}
                className="btn-secondary gap-2 px-3.5"
                title="Change environment"
              >
                <span className={`h-[7px] w-[7px] rounded-full ${env === "local" ? "bg-[#ff9f0a]" : "bg-[#30d158]"}`} />
                {ENVIRONMENTS.find((e) => e.value === env)?.label}
              </button>
              <Segmented
                size="sm"
                value={range}
                onChange={changeRange}
                options={[
                  { value: "7", label: "7D" },
                  { value: "30", label: "30D" },
                  { value: "all", label: "All" },
                ]}
              />
              <button
                className="btn-secondary px-3"
                aria-label="Refresh"
                title="Refresh"
                onClick={() => {
                  setRefreshKey((k) => k + 1);
                  setAsOf(new Date().toISOString());
                }}
              >
                <RefreshIcon className="h-4 w-4" />
              </button>
              <button className="btn-primary" onClick={() => setUploadOpen(true)}>
                <UploadIcon className="h-4 w-4" />
                Upload
              </button>
            </div>
          </div>
          <div className="mt-6">
            <div className="flex w-full rounded-[9px] bg-fill p-[2px] sm:inline-flex sm:w-auto" role="tablist">
              {TABS.map((t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  role="tab"
                  aria-selected={active === t.href}
                  className={`flex-1 whitespace-nowrap rounded-[7px] px-2 py-[5px] text-center text-[13px] font-medium transition-all duration-150 sm:flex-none sm:px-4 ${
                    active === t.href ? "bg-white text-ink shadow-thumb" : "text-ink/70 hover:text-ink"
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
      {children}
      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <EnvironmentDialog open={envOpen} onClose={() => setEnvOpen(false)} />
    </CallsContext.Provider>
  );
}

function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const { env, choose } = useEnvironment();
  const [scoring, setScoring] = useState<"standard" | "enhanced">("standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    setFiles([]);
    setError(null);
    setBusy(false);
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  };

  async function submit() {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    // Each file's own modified time is when an exported call happened.
    form.append("dates", JSON.stringify(files.map((f) => new Date(f.lastModified).toISOString())));
    form.append("engine", ENGINE_FOR[env]);
    form.append("scoring", scoring);
    try {
      await api.form<CallRow[]>("/intel/uploads", form);
      reset();
      onClose();
      router.push("/calls/log");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) {
          reset();
          onClose();
        }
      }}
      title="Upload call recordings"
    >
      <div className="space-y-4">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-9 text-center transition-colors ${
            dragging ? "border-accent bg-accent-soft" : "border-[#c7c7cc] bg-panel hover:bg-[#efeff4]"
          }`}
        >
          <UploadIcon className="mb-2.5 h-6 w-6 text-muted" />
          <span className="text-[15px] font-medium">Drop recordings here</span>
          <span className="mt-0.5 text-[13px] text-muted">or <span className="text-link">choose files</span> · MP3, WAV or M4A</span>
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.m4a"
            multiple
            className="sr-only"
            onChange={(e) => addFiles(e.target.files)}
          />
        </label>

        {files.length > 0 && (
          <ul className="max-h-36 space-y-1 overflow-y-auto text-sm">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-panel px-3 py-1.5 text-[14px]">
                <span className="truncate">{f.name}</span>
                <button
                  className="text-xs text-muted hover:text-bad"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  disabled={busy}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-muted">Environment</legend>
          <div className="grid grid-cols-2 gap-2">
            {ENVIRONMENTS.map((e) => (
              <button
                key={e.value}
                type="button"
                onClick={() => choose(e.value)}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  env === e.value ? "border-accent bg-accent-soft/50 ring-1 ring-accent" : "border-line hover:bg-panel"
                }`}
              >
                <span className="block text-sm font-medium">{e.label}</span>
                <span className={`block text-xs ${e.value === "local" ? "text-warn" : "text-muted"}`}>
                  {e.summary}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-muted">Scoring</legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: "standard", label: "Standard", hint: "One model, majority of three runs" },
                { value: "enhanced", label: "Enhanced", hint: "Claude and OpenAI deliberate. About 2x cost." },
              ] as const
            ).map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setScoring(o.value)}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  scoring === o.value ? "border-accent bg-accent-soft/50 ring-1 ring-accent" : "border-line hover:bg-panel"
                }`}
              >
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-xs text-muted">{o.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {error && <ErrorNote message={error} />}

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy || !files.length}>
            {busy && <Spinner className="h-3.5 w-3.5" />}
            {busy ? "Uploading" : `Upload ${files.length || ""} ${files.length === 1 ? "call" : "calls"}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
