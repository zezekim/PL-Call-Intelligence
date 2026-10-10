"use client";

import { useRef, useState } from "react";
import { ApiError, api, type CallDetail, type Segment } from "@/lib/api";
import { clock } from "@/lib/format";
import { Spinner } from "@/components/ui";
import type { AudioControl } from "@/components/v2/listen";
import { failMessage, useToast } from "@/components/v2/toast";

type Role = "rep" | "customer";

interface Edit {
  op: "text" | "role" | "split" | "insert" | "delete";
  id?: number;
  text?: string;
  role?: Role;
  at?: number;
  start?: number;
}

/**
 * The transcript one line at a time, for fixing what the transcriber got
 * wrong: the words, who said them, a line that is really two people, and a
 * line it missed. Fixes are saved one by one; the grade changes when the
 * call is checked again.
 */
export function TranscriptEditor({
  callId,
  segments,
  repName,
  customerName,
  audio,
  onSaved,
}: {
  callId: string;
  segments: Segment[];
  repName: string | null;
  customerName: string | null;
  audio: AudioControl;
  onSaved: (call: CallDetail) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const names: Record<Role, string> = { rep: repName ?? "Team member", customer: customerName ?? "Customer" };

  async function send(edit: Edit, done?: string): Promise<boolean> {
    setBusy(true);
    try {
      const call = await api.post<CallDetail>(`/intel/calls/${callId}/transcript`, edit);
      onSaved(call);
      if (done) toast({ message: done });
      return true;
    } catch (err) {
      // A refused edit says why ("only lines you added can be deleted").
      const said = err instanceof ApiError && err.status === 400 && err.message;
      toast({ message: said ? said[0].toUpperCase() + said.slice(1) + "." : failMessage(), tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-panel px-3 py-2.5 text-[15px]">
        <p className="text-ink/80">Tap a name to swap who said it. Tap the words to fix them or split the line.</p>
        <button
          className="btn-secondary px-3 py-1 text-[15px]"
          onClick={() => setAdding(Math.round(audio.time * 10) / 10)}
          disabled={busy || adding !== null}
        >
          + Add a missing line at {clock(audio.time)}
        </button>
      </div>

      {adding !== null && (
        <AddLine
          at={adding}
          names={names}
          busy={busy}
          onCancel={() => setAdding(null)}
          onAdd={async (role, text, start) => {
            if (await send({ op: "insert", role, text, start }, "Line added")) setAdding(null);
          }}
        />
      )}

      <ul className="divide-y divide-line">
        {segments.map((s) => {
          const role: Role = s.role === "rep" ? "rep" : "customer";
          const other: Role = role === "rep" ? "customer" : "rep";
          return (
            <li key={s.id} data-seg={s.id} className="grid grid-cols-[108px_minmax(0,1fr)] gap-3 py-2.5 text-[16px]">
              <div className="space-y-0.5">
                <button
                  className={`block max-w-full truncate rounded-full px-2 py-0.5 text-left text-[15px] font-medium ${
                    role === "rep" ? "bg-bubble" : "bg-accent-soft"
                  } hover:ring-1 hover:ring-accent`}
                  title={`Said by ${names[role]}. Tap to change to ${names[other]}.`}
                  disabled={busy}
                  onClick={() => void send({ op: "role", id: s.id, role: other }, `Now said by ${names[other]}`)}
                >
                  {names[role]} ⇄
                </button>
                <button className="tnum px-2 text-[15px] text-muted hover:text-link" onClick={() => audio.seek(s.start, s.id)}>
                  {clock(s.start)}
                </button>
              </div>
              {editingId === s.id ? (
                <LineEditor
                  segment={s}
                  otherName={names[other]}
                  busy={busy}
                  onCancel={() => setEditingId(null)}
                  onSave={async (text) => {
                    if (await send({ op: "text", id: s.id, text }, "Line saved")) setEditingId(null);
                  }}
                  onSplit={async (at) => {
                    if (await send({ op: "split", id: s.id, at, role: other }, `Split. The rest is now ${names[other]}.`)) {
                      setEditingId(null);
                    }
                  }}
                />
              ) : (
                <div className="min-w-0">
                  <button
                    className="w-full rounded px-1 text-left leading-[1.45] [overflow-wrap:anywhere] hover:bg-ink/5"
                    onClick={() => setEditingId(s.id)}
                    disabled={busy}
                  >
                    {s.text}
                  </button>
                  {(s.original_text || s.added || s.manual_role) && (
                    <p className="mt-0.5 flex flex-wrap gap-x-2 px-1 text-[15px] text-muted">
                      {s.original_text && <span title={`Transcribed as: “${s.original_text}”`}>Words fixed</span>}
                      {s.manual_role && <span>Speaker set by you</span>}
                      {s.added && (
                        <>
                          <span>Added by you</span>
                          <button
                            className="text-bad hover:underline"
                            disabled={busy}
                            onClick={() => void send({ op: "delete", id: s.id }, "Line removed")}
                          >
                            Remove
                          </button>
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LineEditor({
  segment,
  otherName,
  busy,
  onSave,
  onSplit,
  onCancel,
}: {
  segment: Segment;
  otherName: string;
  busy: boolean;
  onSave: (text: string) => Promise<void>;
  onSplit: (at: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(segment.text);
  const [hint, setHint] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const changed = text.trim() !== segment.text;
  // The cursor marks where the other person starts. It's read on click (a
  // textarea keeps its cursor after losing focus to the button).
  function splitAtCursor() {
    const at = box.current?.selectionStart ?? 0;
    if (at <= 0 || at >= segment.text.length) {
      setHint(true);
      box.current?.focus();
      return;
    }
    void onSplit(at);
  }
  return (
    <div className="min-w-0 space-y-2">
      <textarea
        ref={box}
        autoFocus
        className="input w-full py-1.5 text-[16px] leading-[1.45]"
        rows={Math.min(6, Math.max(2, Math.ceil(text.length / 60)))}
        value={text}
        aria-label="Line text"
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary px-3 py-1 text-[15px]" disabled={busy || !changed || !text.trim()} onClick={() => void onSave(text)}>
          {busy && <Spinner className="h-3 w-3" />}
          Save line
        </button>
        <button
          className="btn-secondary px-3 py-1 text-[15px]"
          // Splitting cuts the saved line, so it waits until the words are saved.
          disabled={busy || changed}
          title={changed ? "Save the words first" : `Splits at the cursor: the rest is ${otherName}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={splitAtCursor}
        >
          ✂ Split here: rest is {otherName}
        </button>
        <button className="btn-ghost px-3 py-1 text-[15px]" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className={`text-[15px] ${hint ? "text-warn" : "text-muted"}`}>
        {changed
          ? "Save the words first, then you can split the line."
          : `To split, click in the line just before ${otherName} starts talking.`}
      </p>
    </div>
  );
}

function AddLine({
  at,
  names,
  busy,
  onAdd,
  onCancel,
}: {
  at: number;
  names: Record<Role, string>;
  busy: boolean;
  onAdd: (role: Role, text: string, start: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [role, setRole] = useState<Role>("rep");
  const [text, setText] = useState("");
  const [time, setTime] = useState(clock(at));
  const start = parseClock(time);
  return (
    <div className="mb-2 space-y-2 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center gap-2 text-[15px]">
        <label className="inline-flex items-center gap-1.5">
          At
          <input
            className="input tnum w-[72px] py-1 text-[15px]"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            aria-label="Time, minutes:seconds"
          />
        </label>
        <select
          className="input w-auto py-1 text-[15px]"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          aria-label="Who said it"
        >
          <option value="rep">{names.rep}</option>
          <option value="customer">{names.customer}</option>
        </select>
        said:
      </div>
      <textarea
        autoFocus
        className="input w-full py-1.5 text-[16px]"
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What was said"
        aria-label="What was said"
        maxLength={2000}
      />
      <div className="flex gap-2">
        <button
          className="btn-primary px-3 py-1 text-[15px]"
          disabled={busy || !text.trim() || start === null}
          onClick={() => start !== null && void onAdd(role, text, start)}
        >
          {busy && <Spinner className="h-3 w-3" />}
          Add line
        </button>
        <button className="btn-ghost px-3 py-1 text-[15px]" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** "1:23" or "01:23" to seconds; null if it isn't a time. */
function parseClock(value: string): number | null {
  const m = value.trim().match(/^(\d{1,3}):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
