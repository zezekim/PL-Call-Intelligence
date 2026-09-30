"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, type UploadResult } from "@/lib/api";
import { startProgress } from "@/components/route-progress";
import { ENGINE_FOR, ENVIRONMENTS, useEnvironment } from "@/components/environment";
import { UploadIcon } from "@/components/icons";
import { ErrorNote, Modal, Spinner } from "@/components/ui";

export function UploadDialog({
  open,
  onClose,
  onUploaded,
  logHref = "/calls/log",
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
  /** Where the uploaded calls are listed. */
  logHref?: string;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const { env, choose } = useEnvironment();
  const [scoring, setScoring] = useState<"standard" | "enhanced">("standard");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<UploadResult["duplicates"]>([]);
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    setFiles([]);
    setError(null);
    setSkipped([]);
    setBusy(false);
    setProgress(0);
  };

  const finish = () => {
    reset();
    onClose();
    // Already on the Call Log (e.g. right after deleting a call): refresh it
    // in place, since pushing the same URL neither navigates nor refetches.
    onUploaded();
    startProgress(logHref);
    router.push(logHref);
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
    setProgress(0);
    try {
      const result = await api.upload<UploadResult>("/intel/uploads", form, setProgress);
      if (!result.duplicates.length) {
        finish();
        return;
      }
      // Say which files were skipped before moving on.
      if (result.created.length) onUploaded();
      setFiles([]);
      setSkipped(result.duplicates);
      setBusy(false);
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
            dragging ? "border-accent bg-accent-soft" : "border-neutral bg-panel hover:bg-fill"
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
        {skipped.length > 0 && (
          <div className="rounded-xl bg-warn-soft px-4 py-3 text-[14px]">
            <p className="font-medium text-warn">
              {skipped.length === 1 ? "1 file was" : `${skipped.length} files were`} already uploaded and skipped
            </p>
            <ul className="mt-1 space-y-0.5 text-[13px]">
              {skipped.map((d) => (
                <li key={d.call_id + d.filename}>
                  <Link href={`/calls/${d.call_id}`} className="text-link hover:underline" onClick={() => { reset(); onClose(); }}>
                    {d.filename}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {busy && (
          <div
            className="h-[5px] overflow-hidden rounded-full bg-fill"
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy || !files.length}>
            {busy && <Spinner className="h-3.5 w-3.5" />}
            {busy
              ? progress < 1
                ? `Uploading ${Math.round(progress * 100)}%`
                : "Checking files"
              : `Upload ${files.length || ""} ${files.length === 1 ? "call" : "calls"}`}
          </button>
          {skipped.length > 0 && !files.length && (
            <button className="btn-primary" onClick={finish}>
              View call log
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
