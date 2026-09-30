"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Segment } from "@/lib/api";
import { clock } from "@/lib/format";
import { bigButton } from "@/components/v2/kit";

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
  segmentId?: number;
}

/** "1 min 20 sec" for screen readers and anyone who reads clocks slowly. */
function spoken(t: number): string {
  const s = Math.max(0, Math.round(t));
  const m = Math.floor(s / 60);
  return m ? `${m} minute${m === 1 ? "" : "s"} ${s % 60} seconds` : `${s} seconds`;
}

const SPEEDS = [
  { rate: 0.75, label: "Slower" },
  { rate: 1, label: "Normal speed" },
  { rate: 1.25, label: "Faster" },
];

/**
 * The recording and what was said, as one tool. Big labelled controls, the
 * words of the line being played highlighted and kept in view, and the
 * important moments listed as buttons rather than tiny marks on a timeline.
 */
export function ListenPanel({
  src,
  duration,
  segments,
  repName,
  customerName,
  audio,
  markers,
  expired,
}: {
  src: string | null;
  duration: number;
  segments: Segment[];
  repName: string | null;
  customerName: string | null;
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
    box.scrollTo({ top: Math.max(0, line.offsetTop - box.clientHeight / 3), behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (audio.playing && activeId >= 0) scrollTo(activeId, false);
  }, [activeId, audio.playing, scrollTo]);

  useEffect(() => {
    if (audio.target) scrollTo(audio.target.id, true);
  }, [audio.target, scrollTo]);

  const jump = (delta: number) => {
    const el = audio.ref.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(length || el.duration || 0, el.currentTime + delta));
    audio.setTime(el.currentTime);
  };

  const who = (s: Segment) =>
    s.role === "rep"
      ? `${repName ?? "Team member"} (your team)`
      : s.role === "customer"
        ? `${customerName ?? "Customer"} (customer)`
        : "Someone";

  return (
    <section className="rounded-[22px] border-2 border-line bg-surface" aria-labelledby="listen-title">
      <div className="p-6">
        <h2 id="listen-title" className="text-[26px] font-bold tracking-title">
          Listen to the call
        </h2>
        {src ? (
          <>
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
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                className="inline-flex min-h-[64px] items-center gap-3 rounded-full bg-[#0055aa] px-8 text-[22px] font-bold text-white hover:bg-[#004a94] focus-visible:ring-[4px] focus-visible:ring-accent/50"
                onClick={audio.toggle}
              >
                <span aria-hidden className="text-[24px]">
                  {audio.playing ? "❚❚" : "▶"}
                </span>
                {audio.playing ? "Pause" : "Play the call"}
              </button>
              <button className={bigButton.secondary} onClick={() => jump(-10)}>
                ↺ Back 10 seconds
              </button>
              <button className={bigButton.secondary} onClick={() => jump(10)}>
                Forward 10 seconds ↻
              </button>
            </div>

            <div className="mt-5">
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
                className="h-3 w-full cursor-pointer accent-accent"
                aria-label="Move through the call"
                aria-valuetext={`${spoken(audio.time)} of ${spoken(length)}`}
              />
              <p className="mt-1 flex justify-between text-[18px] font-medium tabular-nums">
                <span>{clock(audio.time)}</span>
                <span>{clock(length)}</span>
              </p>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Playback speed">
              <span className="mr-1 text-[18px] font-semibold">Speed:</span>
              {SPEEDS.map((s) => (
                <button
                  key={s.rate}
                  role="radio"
                  aria-checked={rate === s.rate}
                  onClick={() => {
                    setRate(s.rate);
                    if (audio.ref.current) audio.ref.current.playbackRate = s.rate;
                  }}
                  className={`min-h-[48px] rounded-full px-5 text-[17px] font-semibold ${
                    rate === s.rate ? "bg-ink text-canvas" : "bg-fill text-ink hover:bg-fill-hover"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {markers.length > 0 && (
              <div className="mt-6 border-t-2 border-line pt-5">
                <p className="text-[20px] font-semibold">Important moments</p>
                <ul className="mt-3 space-y-2">
                  {[...markers]
                    .sort((a, b) => a.at - b.at)
                    .map((m, i) => (
                      <li key={i}>
                        <button
                          onClick={() => audio.seek(m.at, m.segmentId)}
                          className={`flex min-h-[56px] w-full items-center gap-4 rounded-[14px] px-4 text-left text-[18px] transition-colors ${
                            m.tone === "good" ? "bg-good-soft hover:brightness-[0.97]" : "bg-bad-soft hover:brightness-[0.97]"
                          }`}
                        >
                          <span className="font-bold tabular-nums">▶ {clock(m.at)}</span>
                          <span className="font-semibold">{m.tone === "good" ? "Done well:" : "To do better:"}</span>
                          <span className="min-w-0 flex-1">{m.label}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="mt-3 text-[20px]">
            {expired
              ? "The recording was deleted after 90 days, as planned. You can still read what was said below."
              : "There is no recording for this call."}
          </p>
        )}
      </div>

      <div className="border-t-2 border-line px-6 pb-6 pt-5">
        <h3 className="text-[22px] font-bold">What was said</h3>
        {src && <p className="mt-1 text-[17px] text-ink/80">Tap any line to hear it.</p>}
        <div
          ref={scroller}
          onWheel={() => (userScrolledAt.current = Date.now())}
          onTouchMove={() => (userScrolledAt.current = Date.now())}
          className="relative mt-4 max-h-[60vh] space-y-2 overflow-y-auto pr-2 print:max-h-none print:overflow-visible"
          tabIndex={0}
          aria-label="What was said, line by line"
        >
          {segments.length === 0 && <p className="text-[18px]">Nothing yet.</p>}
          {segments.map((s, i) => {
            const newSpeaker = i === 0 || segments[i - 1].role !== s.role;
            const active = s.id === activeId;
            const cited = s.id === audio.target?.id;
            const rep = s.role === "rep";
            return (
              <div key={s.id} data-seg={s.id} className={newSpeaker && i > 0 ? "pt-3" : ""}>
                {newSpeaker && <p className="mb-1 text-[17px] font-bold">{who(s)}</p>}
                <button
                  onClick={() => audio.seek(s.start)}
                  className={`block w-full rounded-[12px] border-l-[6px] px-4 py-2.5 text-left text-[20px] leading-relaxed transition-colors ${
                    active
                      ? "border-accent bg-accent-soft"
                      : cited
                        ? "border-[#c25e00] bg-warn-soft"
                        : rep
                          ? "border-transparent bg-panel hover:bg-fill"
                          : "border-transparent bg-surface hover:bg-panel"
                  }`}
                  aria-current={active ? "true" : undefined}
                >
                  {active && <span className="sr-only">Playing now: </span>}
                  {s.text}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
