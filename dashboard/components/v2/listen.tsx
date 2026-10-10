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

const RATE_KEY = "pestlaunch.playbackRate";
const RATES = [1, 1.5, 2];
const SKIP = 15;

export interface Marker {
  at: number;
  tone: "good" | "bad";
  label: string;
  segmentId?: number;
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
  customerName = null,
  large = false,
  fixing = false,
  onFix,
  fixer,
}: {
  src: string | null;
  duration: number;
  segments: Segment[];
  repName: string | null;
  audio: AudioControl;
  markers: Marker[];
  expired: boolean;
  customerName?: string | null;
  /** Bigger text and controls, for the Normal and Larger text sizes. */
  large?: boolean;
  /** Fixing the transcript: `fixer` replaces the reading view. */
  fixing?: boolean;
  onFix?: (on: boolean) => void;
  fixer?: React.ReactNode;
}) {
  const [length, setLength] = useState(duration);
  const [rate, setRateState] = useState(1);
  const setRate = useCallback(
    (next: number) => {
      setRateState(next);
      if (audio.ref.current) audio.ref.current.playbackRate = next;
      try {
        window.localStorage.setItem(RATE_KEY, String(next));
      } catch {
        /* storage unavailable */
      }
    },
    [audio.ref],
  );
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(RATE_KEY));
      if (RATES.includes(saved)) setRateState(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Space plays and pauses; the arrow keys skip 15 seconds. Typing, and keys
  // meant for a focused button or slider, are left alone.
  const { ref: audioRef, toggle, setTime } = audio;
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, button, a, [role=menu], [role=dialog], [contenteditable=true]")) return;
      const audioEl = audioRef.current;
      if (!audioEl) return;
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const t = Math.min(Math.max(0, audioEl.currentTime + (e.key === "ArrowLeft" ? -SKIP : SKIP)), length || audioEl.duration || 0);
        audioEl.currentTime = t;
        setTime(t);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [src, audioRef, toggle, setTime, length]);
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
          <h2 className={`${large ? "text-[24px] font-bold" : "text-[18px] font-semibold"} tracking-title`}>
            Listen to the call
          </h2>
          <div className="flex items-center gap-3">
            {markers.length > 0 && !fixing && (
              <div className={`hidden items-center gap-3 whitespace-nowrap sm:flex ${large ? "text-[17px] text-ink" : "text-[16px] text-ink/80"}`}>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-bad" /> To do better
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-good" /> Done well
                </span>
              </div>
            )}
            {onFix && segments.length > 0 && (
              <button
                className={fixing ? "btn-primary" : "btn-secondary print:hidden"}
                onClick={() => onFix(!fixing)}
                aria-pressed={fixing}
              >
                {fixing ? "Done fixing" : "Fix the transcript"}
              </button>
            )}
          </div>
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
              onLoadedMetadata={(e) => {
                if (Number.isFinite(e.currentTarget.duration)) setLength(e.currentTarget.duration);
                e.currentTarget.playbackRate = rate;
              }}
            />
            <button
              className={`flex shrink-0 items-center justify-center rounded-full bg-accent text-white transition-opacity hover:opacity-90 ${
                large ? "h-16 w-16" : "h-11 w-11"
              }`}
              onClick={audio.toggle}
              aria-label={audio.playing ? "Pause" : "Play the call"}
              title={audio.playing ? "Pause (space)" : "Play (space)"}
            >
              {audio.playing ? (
                <PauseIcon className={large ? "h-6 w-6" : "h-4 w-4"} />
              ) : (
                <PlayIcon className={`ml-0.5 ${large ? "h-6 w-6" : "h-4 w-4"}`} />
              )}
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
                      onClick={() => audio.seek(m.at, segmentAt(segments, m.at))}
                      title={`${clock(m.at)} · ${m.label}`}
                      aria-label={`Play ${m.label} at ${clock(m.at)}`}
                      className={`absolute top-0 -translate-x-1/2 rounded-full ring-2 ring-surface ${
                        large ? "h-4 w-4 -top-1" : "h-2.5 w-2.5"
                      } ${
                        m.tone === "bad" ? "bg-bad" : "bg-good"
                      }`}
                      style={{ left: `${Math.min(100, (m.at / length) * 100)}%` }}
                    />
                  ))}
              </div>
              <div className={`tnum flex justify-between ${large ? "text-[18px] text-ink" : "text-[15px] text-muted"}`}>
                <span>{clock(audio.time)}</span>
                <span>{clock(length)}</span>
              </div>
            </div>
            <button
              className={`btn-secondary tnum px-0 ${large ? "min-h-[48px] w-20 text-[18px]" : "w-12 py-1 text-[15px]"}`}
              onClick={() => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length])}
              aria-label={`Playback speed ${rate} times`}
              title="Playback speed"
            >
              {rate}×
            </button>
          </div>
        ) : (
          <p className={large ? "text-[18px]" : "text-[16px] text-muted"}>
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
        {fixing && fixer}
        {!fixing && large && turns.length > 0 && src && (
          <p className="text-[18px] text-ink/80">Tap any line to hear it.</p>
        )}
        {!fixing && turns.length === 0 && <p className={large ? "text-[18px]" : "text-[16px] text-muted"}>Nothing yet.</p>}
        {!fixing && turns.map((turn, i) => {
          const rep = turn.role === "rep";
          return (
            <div key={i} className={`flex min-w-0 ${rep ? "" : "justify-end"}`}>
              <div className={`min-w-0 max-w-[88%] ${rep ? "" : "text-right"}`}>
                <p className={`mb-1 px-1 ${large ? "text-[17px] font-semibold text-ink" : "text-[15px] text-muted"}`}>
                  {rep ? repName ?? "Team member" : turn.role === "customer" ? customerName ?? "Customer" : "Someone"}{" "}
                  <button className="tnum hover:text-link" onClick={() => audio.seek(turn.items[0].start)}>
                    {clock(turn.items[0].start)}
                  </button>
                </p>
                <div
                  className={`inline-block max-w-full rounded-[18px] px-4 py-2.5 text-left leading-[1.45] [overflow-wrap:anywhere] ${
                    large ? "text-[19px]" : "text-[16px]"
                  } ${
                    rep ? "bg-bubble text-ink" : "bg-accent-soft text-ink"
                  }`}
                >
                  {turn.items.map((s) => (
                    <span
                      key={s.id}
                      data-seg={s.id}
                      onClick={() => audio.seek(s.start)}
                      className={`cursor-pointer rounded px-0.5 transition-colors ${
                        s.id === activeId
                          ? "bg-highlight"
                          : s.id === cited
                            ? "bg-highlight/60"
                            : "hover:bg-ink/5"
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

/** The transcript line being spoken at `t`. */
function segmentAt(segments: Segment[], t: number): number | undefined {
  let id: number | undefined;
  for (const s of segments) {
    if (s.start <= t + 0.5) id = s.id;
    else break;
  }
  return id;
}
