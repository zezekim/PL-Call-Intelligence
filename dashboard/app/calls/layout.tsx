"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, type CallRow } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { CallsContext } from "@/components/calls-context";
import { UploadIcon } from "@/components/icons";
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
        <div className="mb-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h1 className="text-[32px] font-bold leading-none tracking-tight">Calls</h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className="hidden text-xs text-muted sm:inline">
                {range === "all" ? "All time" : `Last ${range} days`}
              </span>
              <Segmented
                size="sm"
                value={range}
                onChange={changeRange}
                options={[
                  { value: "7", label: "7d" },
                  { value: "30", label: "30d" },
                  { value: "all", label: "All" },
                ]}
              />
              <button
                className="btn-secondary"
                onClick={() => {
                  setRefreshKey((k) => k + 1);
                  setAsOf(new Date().toISOString());
                }}
              >
                Refresh
              </button>
              <button className="btn-primary" onClick={() => setUploadOpen(true)}>
                <UploadIcon className="h-4 w-4" />
                Upload calls
              </button>
            </div>
          </div>
          <div className="mt-5 overflow-x-auto">
            <div className="inline-flex rounded-xl bg-[#e3e6ec] p-1">
              {TABS.map((t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
                    active === t.href ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">Calls as of {dateTime(asOf)}</p>
        </div>
      )}
      {children}
      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </CallsContext.Provider>
  );
}

const ENGINES = [
  { value: "auto", label: "Automatic", hint: "Deepgram, falling back to local if unavailable" },
  { value: "deepgram", label: "Deepgram", hint: "Cloud transcription, best speaker separation" },
  { value: "local", label: "Local", hint: "Runs on this server; audio never leaves it" },
];

function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [engine, setEngine] = useState("auto");
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
    form.append("engine", engine);
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
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition ${
            dragging ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-accent/50"
          }`}
        >
          <UploadIcon className="mb-2 h-6 w-6 text-accent" />
          <span className="text-sm font-medium">Drop recordings here or click to choose</span>
          <span className="mt-1 text-xs text-muted">MP3, WAV, M4A · up to 200 MB each</span>
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
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-panel px-3 py-1.5">
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
          <legend className="mb-2 text-sm font-medium">Transcription</legend>
          <div className="space-y-1.5">
            {ENGINES.map((e) => (
              <label
                key={e.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 ${
                  engine === e.value ? "border-accent bg-accent-soft/60" : "border-line"
                }`}
              >
                <input
                  type="radio"
                  name="engine"
                  value={e.value}
                  checked={engine === e.value}
                  onChange={() => setEngine(e.value)}
                  className="mt-1 accent-[#1f6feb]"
                />
                <span>
                  <span className="block text-sm font-medium">{e.label}</span>
                  <span className="block text-xs text-muted">{e.hint}</span>
                </span>
              </label>
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
