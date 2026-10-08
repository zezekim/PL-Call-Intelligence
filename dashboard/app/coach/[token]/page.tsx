"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { clock } from "@/lib/format";
import { CheckIcon, PauseIcon, PlayIcon } from "@/components/icons";
import { Spinner } from "@/components/ui";

interface CoachCard {
  business: string;
  rep: string | null;
  title: string;
  what_happened: string | null;
  try_saying: string | null;
  start: number | null;
  audio_url: string | null;
  strength: string | null;
}

/**
 * The page a rep opens from their weekly coaching text, on their phone,
 * without an account: their one thing to work on, the words to say, and the
 * moment from their own call. Big type and one big button.
 */
export default function CoachPage() {
  const { token } = useParams<{ token: string }>();
  const [card, setCard] = useState<CoachCard | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [heard, setHeard] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    document.title = "Your tip for this week";
    api
      .get<CoachCard>(`/public/coach/${token}`)
      .then(setCard)
      .catch(() => setFailed(true));
  }, [token]);

  function play() {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    if (el.currentTime === 0 && card?.start) el.currentTime = Math.max(0, card.start - 1);
    void el.play();
    if (!heard) {
      setHeard(true);
      void api.post(`/public/coach/${token}/listened`).catch(() => undefined);
    }
  }

  if (failed) {
    return (
      <Shell>
        <h1 className="text-[28px] font-semibold leading-tight">This link has expired.</h1>
        <p className="mt-3 text-[19px] leading-relaxed text-ink/80">Ask your manager to send this week&apos;s tip again.</p>
      </Shell>
    );
  }
  if (!card) {
    return (
      <Shell>
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6" />
        </div>
      </Shell>
    );
  }

  const first = (card.rep ?? "").split(/\s+/)[0];
  return (
    <Shell>
      <p className="text-[17px] text-muted">{card.business}</p>
      <h1 className="mt-1 text-[30px] font-semibold leading-tight tracking-title">
        {first ? `${first}, your one thing this week` : "Your one thing this week"}
      </h1>
      <p className="mt-4 text-[24px] font-semibold leading-snug">{card.title}</p>
      {card.what_happened && <p className="mt-3 text-[19px] leading-relaxed text-ink/80">{card.what_happened}</p>}

      {card.try_saying && (
        <div className="mt-6 rounded-3xl bg-accent-soft p-5">
          <p className="text-[16px] font-semibold text-ink/80">Next time, try saying</p>
          <p className="mt-2 text-[22px] leading-snug">“{card.try_saying}”</p>
        </div>
      )}

      {card.audio_url && (
        <div className="mt-6">
          <audio
            ref={audio}
            src={api.url(card.audio_url)}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
          <button
            onClick={play}
            className="flex min-h-[64px] w-full items-center justify-center gap-3 rounded-full bg-accent px-6 text-[20px] font-semibold text-white"
          >
            {playing ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="h-6 w-6" />}
            {playing ? "Pause" : `Hear it on your call${card.start !== null ? ` (${clock(card.start)})` : ""}`}
          </button>
        </div>
      )}

      {card.strength && (
        <p className="mt-8 flex items-start gap-2.5 text-[18px] leading-snug">
          <CheckIcon className="mt-1 h-5 w-5 shrink-0 text-good" />
          <span>
            <span className="font-semibold">You&apos;re already good at:</span> {card.strength.toLowerCase()}
          </span>
        </p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-canvas px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-[560px]">{children}</div>
    </main>
  );
}
