"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Segment } from "@/lib/api";
import { clock } from "@/lib/format";
import { PauseIcon, PlayIcon } from "@/components/icons";

export interface AudioControl {
  ref: React.RefObject<HTMLAudioElement | null>;
  time: number;
  playing: boolean;
  /** Play from `t`, and bring that line of the transcript into view. */
  seek: (t: number, segmentId?: number) => void;
  toggle: () => void;
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  /** The line a jump asked for, so the transcript can scroll to it. */
  target: { id: number; at: number } | null;
}

export function useAudio(): AudioControl {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [target, setTarget] = useState<{ id: number; at: number } | null>(null);
  const seek = useCallback((t: number, segmentId?: number) => {
    setTime(t);
    if (segmentId !== undefined) setTarget({ id: segmentId, at: Date.now() });
    const el = ref.current;
    if (!el) return;
    el.currentTime = Math.max(0, t - 0.3);
    void el.play().catch(() => undefined);
  }, []);
  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);
  return { ref, time, playing, seek, toggle, setTime, setPlaying, target };
}

export interface Marker {
  at: number;
  tone: "good" | "bad";
  label: string;
}

/**
 * The recording and its transcript as one tool: the player stays pinned above
 * the words, the line being spoken is highlighted and kept in view, and any
 * line, marker or piece of evidence plays from that moment.
 */
export function ListenPanel({
  src,
  duration,
  segments,
  repName,
  audio,
  markers,
  expired,
}: {
  src: string | null;
  duration: number;
  segments: Segment[];
  repName: string | null;
  audio: AudioControl;
  markers: Marker[];
  expired: boolean;
}) {
  const [length, setLength] = useState(duration);
  const [rate, setRate] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const userScrolledAt = useRef(0);

  const activeId = useMemo(() => {
    if (audio.time <= 0) return -1;
    let id = -1;
    for (const s of segments) {
      if (s.start <= audio.time + 0.05) id = s.id;
      else break;
    }
    return id;
  }, [segments, audio.time]);

  const scrollTo = useCallback((id: number, force: boolean) => {
    const box = scroller.current;
    const line = box?.querySelector<HTMLElement>(`[data-seg="${id}"]`);
    if (!box || !line) return;
    // Leave the reader alone for a few seconds after they scroll themselves.
    if (!force && Date.now() - userScrolledAt.current < 4000) return;
    const top = line.offsetTop - box.clientHeight / 3;
    box.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (audio.playing && activeId >= 0) scrollTo(activeId, false);
  }, [activeId, audio.playing, scrollTo]);

  useEffect(() => {
    if (audio.target) scrollTo(audio.target.id, true);
  }, [audio.target, scrollTo]);

  const turns = useMemo(() => {
    const out: { role: Segment["role"]; items: Segment[] }[] = [];
    segments.forEach((s) => {
      const last = out[out.length - 1];
      if (last && last.role === s.role) last.items.push(s);
      else out.push({ role: s.role, items: [s] });
    });
    return out;
  }, [segments]);

  const progress = length ? Math.min(100, (audio.time / length) * 100) : 0;
  const cited = audio.target?.id;

  return (
    <section className="card flex flex-col overflow-hidden" aria-label="Recording and transcript">
      <div className="border-b border-line px-5 pb-4 pt-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[17px] font-semibold tracking-title">Recording &amp; transcript</h2>
          {markers.length > 0 && (
            <div className="flex items-center gap-3 text-[12px] text-muted">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-bad" /> Coaching moment
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-good" /> Done well
              </span>
            </div>
          )}
        </div>
        {src ? (
          <div className="flex items-center gap-3">
            <audio
              ref={audio.ref}
              src={src}
              preload="metadata"
              onTimeUpdate={(e) => audio.setTime(e.currentTarget.currentTime)}
              onPlay={() => audio.setPlaying(true)}
              onPause={() => audio.setPlaying(false)}
              onLoadedMetadata={(e) =>
                Number.isFinite(e.currentTarget.duration) && setLength(e.currentTarget.duration)
              }
            />
            <button
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-opacity hover:opacity-90"
              onClick={audio.toggle}
              aria-label={audio.playing ? "Pause" : "Play"}
            >
              {audio.playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="ml-0.5 h-4 w-4" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="relative pt-2">
                <input
                  type="range"
                  min={0}
                  max={length || 0}
                  step={0.1}
                  value={audio.time}
                  onChange={(e) => {
                    const t = Number(e.target.value);
                    audio.setTime(t);
                    if (audio.ref.current) audio.ref.current.currentTime = t;
                  }}
                  className="w-full accent-accent"
                  aria-label="Seek"
                  style={{ backgroundSize: `${progress}% 100%` }}
                />
                {length > 0 &&
                  markers.map((m, i) => (
                    <button
                      key={i}
                      onClick={() => audio.seek(m.at)}
                      title={`${clock(m.at)} · ${m.label}`}
                      aria-label={`Play ${m.label} at ${clock(m.at)}`}
                      className={`absolute top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full ring-2 ring-surface ${
                        m.tone === "bad" ? "bg-bad" : "bg-good"
                      }`}
                      style={{ left: `${Math.min(100, (m.at / length) * 100)}%` }}
                    />
                  ))}
              </div>
              <div className="tnum flex justify-between text-[12px] text-muted">
                <span>{clock(audio.time)}</span>
                <span>{clock(length)}</span>
              </div>
            </div>
            <button
              className="btn-secondary tnum w-12 px-0 py-1 text-[12px]"
              onClick={() => {
                const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
                setRate(next);
                if (audio.ref.current) audio.ref.current.playbackRate = next;
              }}
              aria-label="Playback speed"
            >
              {rate}×
            </button>
          </div>
        ) : (
          <p className="text-[14px] text-muted">
            {expired
              ? "The recording was deleted under the retention policy. The transcript remains."
              : "No recording for this call."}
          </p>
        )}
      </div>

      <div
        ref={scroller}
        onWheel={() => (userScrolledAt.current = Date.now())}
        onTouchMove={() => (userScrolledAt.current = Date.now())}
        className="relative max-h-[68vh] min-h-[240px] flex-1 space-y-3 overflow-y-auto px-5 py-5 print:max-h-none print:overflow-visible"
      >
        {turns.length === 0 && <p className="text-[14px] text-muted">No transcript yet.</p>}
        {turns.map((turn, i) => {
          const rep = turn.role === "rep";
          return (
            <div key={i} className={`flex min-w-0 ${rep ? "" : "justify-end"}`}>
              <div className={`min-w-0 max-w-[88%] ${rep ? "" : "text-right"}`}>
                <p className="mb-1 px-1 text-[12px] text-muted">
                  {rep ? repName ?? "Rep" : turn.role === "customer" ? "Customer" : "Speaker"}{" "}
                  <button className="tnum hover:text-link" onClick={() => audio.seek(turn.items[0].start)}>
                    {clock(turn.items[0].start)}
                  </button>
                </p>
                <div
                  className={`inline-block max-w-full rounded-[18px] px-4 py-2.5 text-left text-[15px] leading-[1.45] [overflow-wrap:anywhere] ${
                    rep ? "bg-bubble text-ink" : "bg-accent text-white"
                  }`}
                >
                  {turn.items.map((s) => (
                    <span
                      key={s.id}
                      data-seg={s.id}
                      onClick={() => audio.seek(s.start)}
                      className={`cursor-pointer rounded px-0.5 transition-colors ${
                        s.id === activeId
                          ? rep
                            ? "bg-highlight"
                            : "bg-white/30"
                          : s.id === cited
                            ? rep
                              ? "bg-highlight/60"
                              : "bg-white/20"
                            : rep
                              ? "hover:bg-ink/5"
                              : "hover:bg-white/15"
                      }`}
                    >
                      {s.text}{" "}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
