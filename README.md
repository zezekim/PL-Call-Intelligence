# PL Call Intelligence

Call intelligence for pest control companies. Upload recorded calls and get, for
every call:

- a **transcript** with the rep and the customer told apart
- the **call type**: sales, retention, re-service, scheduling, billing or other service
- **what happened**: outcome, service discussed, price quoted, objections, cancel
  reason and save offers, resolution, appointment, and the follow-ups promised
- the **PestLaunch scorecard grade**, step by step, each point backed by a quote
  from the call that is checked against the transcript
- **coaching** for the rep, anchored to moments in the recording

**Version 2** turns all of that into answers an owner can act on in a few
seconds. It says what's happening, whether it's good or bad, what matters most,
and what to do next. It covers new customers, customers who want to cancel,
and customers with a problem. It also includes a call-back list that fills
itself, with the words to say, and coaching per team member.

The build also includes a live **AI receptionist**. Callers can ask questions,
book an inspection, or be put through to a person. Each receptionist call is
recorded and goes through the same pipeline, graded on the same scorecard as
the human reps.

| | |
|---|---|
| Live app | https://pestlaunch.ramil.org (opens v2 after sign-in) |
| **v2 walkthrough** | https://www.loom.com/share/f790cc5d2af3449392c13c176db230e9 |
| v1 walkthrough | https://www.loom.com/share/60cd05b4edc5427bbb23c99218f02363 |
| AI receptionist | +1 (385) 336-0152 |
| Version | 2.0 (see `VERSION`); the running build is at `/version` |

---

## Contents

1. [As-built plan](#1-as-built-plan)
2. [Architecture](#2-architecture)
3. [The owner views (v2)](#3-the-owner-views-v2)
4. [The analysis pipeline](#4-the-analysis-pipeline)
5. [Scorecards](#5-scorecards)
6. [Why the grades can be trusted](#6-why-the-grades-can-be-trusted)
7. [The original dashboard (v1)](#7-the-original-dashboard-v1)
8. [The AI receptionist](#8-the-ai-receptionist)
9. [Data model](#9-data-model)
10. [API](#10-api)
11. [Security and privacy](#11-security-and-privacy)
12. [Cost control](#12-cost-control)
13. [Running it](#13-running-it)
14. [Configuration](#14-configuration)
15. [Deployment and operations](#15-deployment-and-operations)
16. [Testing](#16-testing)
17. [Results on the sample calls](#17-results-on-the-sample-calls)
18. [Known limitations](#18-known-limitations)
19. [What's next](#19-whats-next)
20. [Repository layout](#20-repository-layout)

---

## 1. As-built plan

Part A covers the revision round (v2). Part B is the original plan for the
first submission (v1), on which v2 is built.

### Part A: Version 2

#### A.1 The feedback, and how each point was answered

The review of v1 found the analysis strong but the presentation made the owner
think too much. The bar for v2: every page answers in 3–5 seconds what's
happening, whether it's good or bad, what matters most, and what to do next.

| Feedback | As built in v2 | Where |
|---|---|---|
| Overview leads with "calls analyzed" | Today opens with a one-sentence verdict in words (no numbers to interpret), then three cards: **New customers** (said yes), **Customers who want to cancel** (kept), **Customers with a problem** (fixed on the call). Call counts move to a quiet footer | `app/v2/page.tsx`, `brief.headline`, `brief._sales/_retention/_service` |
| Each area needs a clear good or bad | Every card has a status in words and colour: *Good*, *Could be better*, *Needs work*, or *Not enough calls yet* (under 3 calls, an area isn't judged). Goals are editable in Settings | `brief._judge`, `MIN_JUDGE`, Settings → Goals |
| Coaching bars looked positive when they meant misses | Bars always fill with what went right, in the status colour, with a tick at the goal. Misses are said in words ("Skipped on 19 of 19 calls"), never as a long red bar | `components/v2/kit.tsx` (`Meter`) |
| Too much at once | One verdict, three cards, the top three things to do (the rest one tap away), and one coaching focus for the week. Detail is folded, never removed: "Show 2 more", "More", a ••• menu for rare actions | all v2 pages |
| Say what to do next | "Do these first" ranks open work across the business: cancellations nobody tried to save, overdue call-backs, unfixed problems, promises made. Each links to where it gets done | `brief._todo` |
| Call page: recording and transcript together | One panel: the player is pinned above the transcript. The line being spoken is highlighted and kept in view, and any line, marker or quote plays from that moment. Keyboard: space, ← / → | `components/v2/listen.tsx` |
| Pipeline "next step" must be an owner action, none for Won | Call back lists people, not stages: "Call Jordan back", with urgency (*Late by 2 days*, *Call today*, *Waiting a long time*) and what was promised. Decided leads have no next step and fold away | `brief.lead_action`, `app/v2/pipeline/page.tsx` |
| Rep pages: doing well / improve / coach on | Each person's page answers it in two cards: **Teach next** (the step, how often it's skipped, the exact words, and a real moment from their own calls to listen to together) and **Good at** | `brief.rep_brief`, `app/v2/reps/[id]/page.tsx` |
| Free to diverge from the existing UI | v2 is a new set of routes under `/v2`; v1 stays intact for comparison, one click away | `app/v2/`, `app/calls/layout.tsx` |

Beyond the feedback:

- **The AI suggests the words to say.** Each call-back has an opening line built
  from what the call found: the name, the price, the pests, who they spoke to.
  It has a Copy button and costs nothing extra in AI.
- **Plain language throughout.** Scorecard steps have everyday names ("Explain
  the plan", "Show you care"). Raw AI phrases are cleaned up: pest descriptions
  become short names, and "unknown" never appears as a customer's name.
- **Undo for decisions.** "Said yes" and "Said no" take effect at once, with a
  toast and Undo. A failed save puts things back and says so.
- **Text size** (Small, Normal, Larger) scales the whole app evenly, like the
  system setting on a Mac or iPhone.
- **Friendly states.** A deleted or broken link explains itself and offers a
  way back. A page that fails offers Try again. Loading placeholders match the
  shape of the page that's coming. Numbers refresh when you return to the tab.
- **v2 is the default.** Sign-in, the bare address and the sidebar's Calls link
  all open v2.

#### A.2 After the v2 review

The v2 review asked for three more things: every button doing exactly what it
says, scoring and coaching that hold up on every kind of call, and less to
interpret. An audit of each v2 action and the scoring pipeline per call type
found and fixed:

| Found | Fixed |
|---|---|
| The 7D / 30D picker on **All calls** didn't filter the list, so Today's counts and the lists they link to could disagree | `/intel/calls` takes `days`; every v2 tab follows the picker |
| "Could not read" on Today opened a filtered list with no filter shown, and *All calls* didn't clear it | It has its own chip, and clears like the others |
| A person's "See all" searched their name as text: it picked up calls that mentioned them and missed calls assigned by hand | It filters by that person, with a chip to clear |
| "N more steps to be good" was worked out from the scorecard's size | The API returns each scorecard's Green cut-off |
| A call retyped by a manager was graded on details triage never filled in for that type (a call retyped to sales got all four objection points free) | The manager's type goes to triage up front |
| A voicemail could be graded if it leaned to a call type | Anything triage says can't be scored (voicemail, wrong number) is never graded |
| A manager's ruling followed a call to another scorecard, where the same step name means something else | Each ruling records its scorecard and only applies there |
| Coaching pooled same-named steps across scorecards: on a cancellation, *Present Solution* is a save offer | Those steps are counted and coached apart (*Make a save offer*) |
| A coaching tip could come from a call where the step was done; undecided AI disagreements counted as misses | Tips come only from calls where the step was missed; disputed steps count once a manager decides them |
| *Following the call steps* was judged on a single call, and counted the AI receptionist in the team's numbers | Same 3-call guard as the other areas; the receptionist is kept apart, as it already was in coaching |
| A person's page had two cards about one step | One **Teach next** card, the same shape as Today's coaching |

#### A.3 Build phases

| Phase | Delivered |
|---|---|
| 1. Owner brief API | `intel/brief.py`: verdicts per area against goals, change against the previous period, small-sample guard, prioritised to-do, coaching focus with a real example, owner actions for leads, per-person briefs. Additive endpoints under `/intel/v2/*`; v1 endpoints untouched |
| 2. Owner views | Today, Call back, Team, All calls, call page and person page under `/v2` |
| 3. Plain language and accessibility | Everyday step names, status always in words as well as colour, three text sizes, WCAG AA contrast in both themes |
| 4. Sharper judgement | Headline covers every area behind target; coaching tip chosen to be mainly about the focus step; one or two calls shown but not judged as a pattern |
| 5. Editable goals | Goals in Settings, read at request time |
| 6. Restraint pass | Top three first, the rest folded; one-sentence summaries; ••• menu for rare actions; repeated information removed |
| 7. Reliability | Undo toasts, instant updates with rollback, friendly error and missing states, page-shaped loading, error boundary, auto-refresh on return |
| 8. AI assistance | Suggested opening lines; placeholder names and pest phrases cleaned |
| 9. Tests and release | Browser tests for every v2 page on made-up data, with axe accessibility checks in light and dark; v1 banner; v2 as the default |

#### A.4 Key decisions

| Decision | Why |
|---|---|
| Build v2 beside v1, not over it | v1 was the submitted version; keeping it lets the two be compared side by side. The backend changed only by adding |
| Words first, numbers second | An owner should know good or bad without reading a number. Every status is a word; numbers support it |
| Never judge on one or two calls | With fewer than 3 calls an area says *Not enough calls yet*, and a person's page says the picture may change. Two calls is a story, not a pattern |
| Bars show what went right | A bar that fills with misses looks like success at a glance. Filling with successes, with a goal tick, can't be misread |
| Fold, don't hide | Restraint without losing anything: the important item is on screen, and the rest is always one tap away and says how many |
| Rules, not another AI call, for v2's text | Verdicts, actions and opening lines are built in code from the existing analysis. They're instant, consistent, free, and every word is traceable to the call |
| Test v2 on made-up data | The browser tests never touch real customer calls, and they run the same in CI and locally |

### Part B: Version 1 (original submission)

#### B.1 The brief, and where each part lives

| Requirement | As built | Where |
|---|---|---|
| Process the call recordings | Drag-and-drop upload (single or batch) with progress, duplicate detection and a database-backed job queue; folder import from the command line | `intel/ingest.py`, `intel/jobs.py`, `scripts/import_calls.py` |
| Transcript | Deepgram Nova-3 (Cloud) or faster-whisper (Local), chosen per upload; rep and customer told apart | `intel/transcribe.py`, `intel/transcript.py` |
| Call type | Triage pass classifies six call types with a confidence; low-confidence calls are flagged **Check type** for a manager to confirm or change | `intel/analyze.py` (`TRIAGE_SCHEMA`) |
| Outcome and details | Sales, retention and service details, appointment, customer priorities, follow-ups owed | `intel/analyze.py`, `intel/followups.py` |
| PestLaunch score and grade | The three scorecards from the manuals encoded as data; step verdicts from the model; totals, grades and automatic awards computed in code | `intel/rubrics.py`, `intel/analyze.py` |
| Coaching | Two or three coaching moments per call, highest impact first, each tied to scorecard steps and a timestamp, with "try saying" wording; strengths with verified quotes | `intel/analyze.py` |
| Simple review UI | Overview, Pipeline, Reps, Call Log, call detail with synced audio, manager overrides, Settings | `dashboard/` |
| Deployed app, repo, README, Loom | https://pestlaunch.ramil.org, this repository, this file, the v1 walkthrough above | — |

Beyond the brief:

- the AI receptionist, with warm transfer
- enhanced two-model scoring
- a receptionist playbook learned from the graded calls
- a weekly email digest
- a spending cap
- dark mode
- printable reports
- CI/CD with browser tests

#### B.2 Starting point

The build extends **CallSentry**, a self-hosted voice-AI platform I had already
written. It contributed a FastAPI service with async Postgres, a provider
registry with local→cloud→mock fallback, a cost ledger, encrypted per-tenant
credentials, a Twilio media-stream voice pipeline, and a knowledge-base agent.
Call intelligence was added as a new domain (`app/callsentry/intel/`) on that
foundation, rather than bolted onto the receptionist code.

#### B.3 Build phases

| Phase | Delivered |
|---|---|
| 1. Foundations | Manuals encoded as scorecards; calls table extended into a job queue; upload and storage outside the repo |
| 2. Transcription | Deepgram and Whisper behind one interface; stereo channel split; mono speaker attribution from the conversation; sentence-level segments |
| 3. Analysis | Triage schema, per-scorecard scoring schema, structured outputs, quote verification, manual rules computed in code |
| 4. Consistency | Three-run majority consensus; sharper step criteria after comparing runs; *Borderline* marking where runs split |
| 5. Review UI | Overview with the three views, Call Log, call detail with audio sync, Reps, Pipeline |
| 6. Deployment | Docker Compose stack, Caddy TLS, self-hosted runner deploys on every green push, backups, health checks |
| 7. Settings and environments | Write-only API keys in the dashboard; Cloud/Local environment chosen at sign-in; daily spend cap |
| 8. Enhanced scoring | Live model lists from Anthropic and OpenAI; second-opinion model; deliberation on disagreements |
| 9. Receptionist | Enabled on the demo number; call process in its persona; stereo recording scored like any call; playbook learned from graded calls |
| 10. Manager tools | Step overrides, rep and date correction, follow-up checklist with assignees, disputed-step review |
| 11. Polish and hardening | Apple-style UI, accessibility audit (WCAG AA, both themes), security headers, rate limits, dark mode, print, digest, error reporting |

#### B.4 Key decisions

| Decision | Why |
|---|---|
| The model judges steps; code computes everything else | Grades must be reproducible and match the manuals exactly. Thresholds, automatic awards, totals and timestamps are never left to the model |
| Every point needs a quote, verified against the transcript | Makes each point checkable by a manager in one click, and exposes invented evidence |
| Three runs with a majority vote (Standard) | The same call graded twice by one model differed by several points on borderline steps; the majority removes most of that variance |
| A second model from another provider (Enhanced) | Two model families make different mistakes. Disagreements are argued out, and what's still disputed goes to a manager instead of being guessed |
| Postgres as the job queue (`FOR UPDATE SKIP LOCKED`) | No extra broker to run; a crash leaves the call in a visible, retryable state |
| Speaker roles from content on mono audio | Acoustic diarisation on 8 kHz mono phone audio was unreliable in testing; the conversation itself identifies the rep reliably |
| Overrides stored apart from the analysis | Re-scoring a call keeps the manager's decisions |
| Recordings outside the repo, with an expiry stamped at upload | The recordings are real customer calls; changing the policy later never retroactively deletes media |

---

---

## 2. Architecture

```
                         ┌────────────── Caddy (TLS, security headers) ──────────────┐
 browser ───────────────►│  /          → dashboard (Next.js 15)                      │
                         │  /api/*     → app (FastAPI)                               │
 Twilio (voice) ────────►│  /ws/*      → pipecat (media streams)                     │
                         └───────────────────────────────────────────────────────────┘
                                          │
   app (FastAPI) ─────────────────────────┼──────────────────────────────────────────
   ├─ REST API, auth, settings, webhooks  │   Postgres 16 + pgvector   calls, analyses, leads,
   ├─ job runner: transcribe → triage →   │                            follow-ups, reps, users,
   │  score → store (N workers)           │                            cost ledger, settings
   ├─ receptionist brain (/internal/turn) │   Redis                    live call state, rate
   ├─ background loop: retention sweep,   │                            limits, digest de-dup
   │  reminders, weekly digest            │
   └─ provider registry ──► Deepgram · Anthropic · OpenAI · Whisper worker · Ollama (optional)

   pipecat   Twilio audio in/out, turn detection, barge-in, stereo recording
   worker    faster-whisper transcription over HTTP (Local environment)
```

| Service | Role |
|---|---|
| `caddy` | Only public entry point (80/443). Automatic TLS, HSTS, CSP, routing |
| `dashboard` | Next.js App Router, Tailwind, client components against the API. Owner views (v2) under `/v2`, original views (v1) under `/calls` |
| `app` | FastAPI + SQLAlchemy async. API, job runner, analysis, receptionist logic |
| `pipecat` | Voice transport only: audio, endpointing, playback, recording. No conversation logic |
| `worker` | Local speech to text (faster-whisper) |
| `postgres` | Primary store; pgvector for the knowledge base |
| `redis` | Ephemeral state: live calls, login throttling, digest de-duplication |
| `ollama` | Optional local language model (compose profile `local-llm`) |

v2 added no new service or table. Its four endpoints (`/intel/v2/*`) read the
same analyses and turn them into verdicts, actions and coaching in
`intel/brief.py`.

The **provider registry** (`core/providers.py`) sits in front of every
inference call. It records each attempt on the call, falls back
local→cloud→mock, and refuses paid providers once the daily spending cap is
reached.

---

## 3. The owner views (v2)

Built for an owner with no training: every page answers *what's happening,
good or bad, what matters most, what to do next* within a few seconds.

**Design rules**

- Apple-style restraint: system greys, one accent blue, white cards.
- One meaning per colour: green good, amber below the goal, red a problem.
  Colour always comes with a word.
- Plain words everywhere: "Said yes", not "Won"; "Explain the plan", not
  "Expectation Statement".
- The most important thing first. Secondary detail is folded with a count
  ("Show 4 more"), never lost.

**Pages**

| Page | What it answers |
|---|---|
| **Today** (`/v2`) | A one-sentence **verdict**: what matters most, where to start, what to teach. Three **area cards**: New customers, Customers who want to cancel, Customers with a problem. Each shows a status, the number against the goal, the change since the previous period, why, and one link to act. **Do these first**: the top three actions, the rest folded. **What to teach this week**: the step that would help the most calls, the words to teach, a link to hear it on a real call, and who to start with. A footer gives calls checked, calls still processing or unreadable, calls needing a decision, and the **AI agreement score** (see below) |
| **Call back** (`/v2/pipeline`) | How many need a call now, how many are still deciding (and their value), how many said yes. Then each person to call, most urgent first. Each row shows urgency, what we promised, who they spoke to, the pests and the price. A **suggested opening line** has a Copy button. **Listen**, **Said no** and **Said yes** buttons update at once, with Undo. Decided leads fold under *Already decided*, with *Not decided after all* to reopen one. The list fills itself from sales calls and receptionist bookings |
| **Team** (`/v2/reps`) | Everyone, whoever needs help most first, with their share of call steps, trend, the one thing to teach and one strength. People with fewer than 3 calls are listed last and marked *Too few calls to be sure* |
| **Person** (`/v2/reps/{id}`) | A sentence verdict, then **Teach next**: the step, how often it's skipped against an 8-in-10 goal, what happened, what to say next time, and a link to listen together. Beside it, **Good at** with an example to hear. Below: recent calls (with a link to all of that person's calls), and every step folded |
| **All calls** (`/v2/calls`) | Search that follows typing (customer, team member, or words said), filter by kind of call, quick filters (*Need work*, *Need your decision*, *May be the wrong type*), paging that survives going back |
| **Call** (`/v2/calls/{id}`) | The verdict: kind of call and outcome, a one-sentence summary (*More* for the rest), score and grade, one thing done well and one to do better, each playable. The **recording and transcript** sit in one panel. **Coaching**: the first tip with "try saying", the rest folded. **The call steps**: skipped first, one line each, with the reason, the quote and *Not right? Mark it as done* on tap; done steps folded. Promises made, details, and a ••• menu: check again, change the kind of call, print, open in v1, delete |

**Call-back urgency.** A lead is due 1 day after first contact when new, or 2
days after a price or a "let me think". After that it's *Late by N days*. On
the day it's *Call today*, and after 14 days without contact *Waiting a long
time*. Ranking: late, then today, then waiting long, then upcoming; within
each, priced leads first.

**What the AI adds, without another AI call.** Everything in v2 is computed in
code from the existing analysis, so it's instant and free:

- the verdicts
- the to-do ranking
- the coaching focus: the most-skipped step, ignoring automatic awards, plus
  the tip that's mainly about it
- each lead's action
- the opening lines

**AI agreement score.** This shows how often managers keep the AI's step marks,
on calls where a manager corrected at least one step. Only the AI's own
verdicts count: automatic awards are rules, and a step the two models disputed
was never the AI's call, so deciding one isn't a correction. Calls a manager
read without changing anything leave no trace, so the score can only err on
the low side. It's computed in `brief.accuracy` from the corrections already
stored.

**Interaction details**

- Toasts with Undo for decisions; failures say so plainly and put things back.
- Space plays and pauses the recording, and ← / → skip 15 seconds. The
  playback speed is remembered.
- The period (7 days, 30 days, all) is remembered, and the page refreshes by
  itself when you return to the tab.
- Three text sizes scale the whole app evenly.
- Phone layouts, dark mode and print are supported.
- Missing or deleted pages explain themselves. Every v2 page has an error
  boundary.

---

## 4. The analysis pipeline

```
upload ─► fingerprint ─► queue ─► transcribe ─► triage ─► score ─► verify ─► store ─► leads / follow-ups
            (sha256)    (calls)   Deepgram or   1 call    Standard: ×3 + majority
                                  Whisper                 Enhanced: 2 models + deliberation
```

### 4.1 Ingest

- Accepts MP3, WAV and M4A up to 200 MB. Each file is probed with ffprobe and
  stored as `uploads/<business>/<call>.<ext>`.
- The browser sends each file's modified time, which for call exports is when
  the call happened. It can be corrected on the call page.
- A SHA-256 fingerprint is stored per file. Re-uploading a recording that's
  already in the system is reported and skipped, so it's never scored or paid
  for twice.
- A recording expiry is stamped at upload (`RECORDING_RETENTION_DAYS`,
  default 90).

### 4.2 Queue

The `calls` table is the queue. Statuses:

`queued` → `transcribing` → `queued_analysis` → `analyzing` → `done` / `failed`

- Workers claim rows with `SELECT … FOR UPDATE SKIP LOCKED`, so parallel
  workers never take the same call.
- A failed call keeps its error and can be retried from the UI. It retries
  from the stored transcript when one exists, so a scoring failure never pays
  for transcription twice.
- Calls stuck mid-flight by a restart are re-queued at startup.

### 4.3 Transcription

- **Cloud: Deepgram Nova-3.**
  - Stereo recordings use multichannel mode, one speaker per channel, so rep
    and customer are separated exactly.
  - Mono recordings use paragraph and sentence segmentation.
- **Local: faster-whisper** (`small.en` by default) on the server. The audio is
  never sent to a transcription service. It's slower: about a fifth of the
  call's length.
- **Mono speaker attribution.** Acoustic diarisation on mono 8 kHz phone audio
  was unreliable, so every sentence is attributed to the rep or the customer
  by the triage pass, from the content of the conversation.
- **Receptionist calls** are recorded in stereo with the agent on a fixed
  channel, so their roles are exact.

### 4.4 Triage

One structured-output pass over the numbered transcript returns:

- the call type and a confidence, with a one-line reason
- the rep's name, and the line where they gave it
- the customer's name
- the direction of the call
- each speaker's role
- sales details: service discussed, price quoted, objections (each with a
  line number), outcome, why it didn't close
- retention details: cancel reason from a fixed list, root cause, save offers
  from the manual's solution bank, outcome, whether the first offer was
  accepted
- service details: request, actions taken, resolution
- pests, appointment, the customer's priorities, follow-ups owed (action,
  owner, due), and end-of-call sentiment
- whether the call is scorable at all (voicemail, wrong number, no
  conversation)

### 4.5 Scoring

The call type selects a scorecard (section 5). The model gets the scorecard's
step criteria, the manual's notes, and the numbered transcript. For every step
it returns met or missed, a reason, and evidence quotes with line numbers.

- **Standard mode** runs the scoring model three times independently. Each
  step takes the majority verdict. A 2–1 split is shown as **Borderline**.
  Only the first run writes coaching, which keeps output tokens down.
- **Enhanced mode** has the scoring model and a second-opinion model from the
  other provider grade independently.
  - For every step they disagree on, each model sees the other's verdict and
    evidence and gives a final answer.
  - Agreement is recorded per step: `both`, `settled` (agreed after
    deliberating) or `disputed`.
  - Disputed steps are not awarded. They show under **Needs attention** until
    a manager rules on them.
- **Structured outputs everywhere.**
  - Anthropic: `output_config.format` JSON schema, streamed, with adaptive
    thinking for offline scoring.
  - OpenAI: strict `response_format` JSON schema, with `reasoning_effort` where
    the model supports it.
- **Manual rules are applied in code**, never by the model:
  - A sales call with no objections is awarded all four Overcome Objections
    steps (the manual's rule).
  - On a retention call, *Repeat* is awarded when the first save offer is
    accepted.
  - Scorecard selection, totals, grade thresholds and timestamps are computed.

### 4.6 Verification and storage

- Every evidence quote is looked up in the line it cites, with fuzzy matching
  for punctuation and filler words. The call's **evidence verified %** is
  stored, and unverifiable quotes are flagged.
- Timestamps always come from the transcript, never from the model.
- The analysis is stored with:
  - the models used and the scoring mode
  - the prompt version, per-call cost, and the full triage
  - step items and coaching
- Manager overrides live in a separate column and are re-applied on every
  re-score.
- Sales calls create or advance a **lead** matched by customer name.
  Receptionist bookings create leads too.
- Follow-ups owed become **follow-up** rows.

---

## 5. Scorecards

Encoded from the PestLaunch office and sales call manuals in
`app/callsentry/intel/rubrics.py`. Each step is binary: met or missed.

| Call type | Scorecard | Steps | Gold | Green |
|---|---|---|---|---|
| Sales | Sales Call Scorecard | 17 | 17 | 14+ |
| Retention (cancellation) | Retention Call Scorecard | 12 | 12 | 11 |
| Re-service, scheduling, billing, other service | Call Process Scorecard | 12 | 12 | 11 |

Anything below Green is **Below standard**.

**Call Process (12):**
- **Validation:** Validate, Confidence Statement, Expectation Statement
- **Understand:** Investigate, Summary Statement, Expectation Statement
- **Solve:** Present Solution, Consensus, Close
- **Verify:** Provide a Conclusion, Thank the Customer, Offer Final Information

**Retention (12):**
- **Validation:** Validate & Confidence Statement, Transition Statement, Do Your Research
- **Understand:** Investigate, Validate & Summary Statement, Validate & Expectation Statement
- **Solve:** Present Solution, Consensus, Repeat (when necessary)\*
- **Verify:** Provide a Conclusion, Thank the Customer, Leave a Teaser

**Sales (17):**
- **Validation:** Validate, Confidence Statement, Expectation Statement
- **Understand:** Investigate, Summary Statement, Expectation Statement
- **Solve:** Present Solution, Consensus, Close
- **Pricing:** Pricing
- **Overcome Objections:** Agree\*, Restate & Insinuate\*, Resolve\*, Re-Close\*
- **Verify:** Provide a Conclusion, Offer Final Information, Thank the Customer

\* Awarded automatically when the situation never arose, per the manual.

Each step's criteria are written to be decidable from a transcript. For
example, a generic "sure, I can help" doesn't count as *Validate*; the rep
has to name the customer's actual situation.

---

## 6. Why the grades can be trusted

- **Evidence you can check.** Every point cites a transcript line. Clicking it
  plays the recording from that moment. Quotes that can't be found are flagged.
- **Code decides the grade.** The model never adds up a score or picks a grade.
- **Variance is controlled.** Standard mode uses a three-run majority. Enhanced
  mode uses two model families, and every step's agreement is shown
  (*Borderline*, *Settled*, *Disputed*).
- **Humans have the last word.**
  - A manager can overrule any step, with a note. The grade is recomputed,
    and the change is attributed and dated.
  - Call type, rep and call date can all be corrected.
- **Uncertainty is surfaced, not hidden.** Low-confidence call types show
  **Check type**. Disputed steps appear under **Needs attention**. Failed
  calls say why and can be retried.

---

## 7. The original dashboard (v1)

v1 is the version first submitted, kept under `/calls` for comparison. Each v1
page carries a small banner linking to the same page in v2. Everything below
still works as described.

Apple-style, restrained UI: system greys, one accent blue, and status colours
reserved for good, attention and problem, always shown beside a text label.
It works at phone width, follows the system light/dark appearance (or a choice
in Settings), and passes an automated WCAG 2 AA audit (axe) in both themes.

| Page | What it answers |
|---|---|
| **Overview** (`/calls`) | Calls analyzed, average score, sales close rate, cancellations saved, share meeting standard. **Needs attention**: open follow-ups, sales not closed, cancellations with no save offer, unresolved service calls, disputed steps, call types to confirm, failed recordings. The three views (sales, retention, customer service) and what to train on. Filter by 7 days, 30 days or all |
| **Pipeline** | Leads created by sales calls and receptionist bookings: New, Quoted, Follow-up, Won, Lost. Cards expand for service, price and next step. Drag to move; the next call with that customer moves the lead again |
| **Reps** | Per rep: average score, grades, sales close rate, score trend by call, steps missed most, and hit rate on each step |
| **Call Log** | Search across customer, rep, transcript and call ID. Filter by type, rep and grade. Sort by date, score, length, rep or type. Paged. Shows processing status and disputed steps |
| **Call detail** | Summary and details; follow-up checklist with assignees; scorecard with evidence, agreement and deliberation; coaching with "try saying"; transcript as chat bubbles, synced to the audio; re-score (standard or enhanced), change call type, correct rep or date, print report, delete |
| **Settings** | Business name, time zone and transfer number. API keys (write-only). Scoring model (live lists from Anthropic and OpenAI) and mode. Transcription default. Twilio and **Connect number**. Weekly digest and SMTP. Spending cap and today's spend. Receptionist playbook. Team (admin / view-only). Password. Appearance |

Other details:

- **Environment modal** at sign-in: Cloud (Deepgram, seconds per call) or
  Local (Whisper on the server, private, slower).
- **Upload dialog:** progress %, duplicate report, environment and scoring
  choice.
- **Update notice** when a newer build is deployed; version shown in the
  sidebar.
- **Page progress bar**, cached responses so moving between tabs is instant,
  ⌘K call search.
- **Times** are shown in the business's time zone, labelled when it differs
  from the viewer's.

---

## 8. The AI receptionist

A live phone agent on the Twilio number, built on the CallSentry voice stack.

- **Transport** (`pipecat/`):
  - Twilio bidirectional media streams, energy-based endpointing and barge-in.
  - Turns are handled one at a time: speech that arrives while a reply is in
    flight is merged into the next turn, so replies never cut each other off.
- **Brain** (`app/callsentry/agents/`):
  - Intent detection: booking, question, emergency, escalate, cancel, goodbye,
    wrong number, with frustration detection.
  - A persona that follows the company's own 4-step call process.
  - A knowledge-base agent that answers only from the FAQ and abstains when it
    can't. It only confirms pests the FAQ names, and only quotes prices when
    asked.
  - Replies are capped at two short spoken sentences.
- **Booking:** two-hour arrival windows within business hours, one booking per
  call, and a confirmation read back (and texted, when SMS is enabled).
- **Returning callers** are greeted by name, with context from their last call.
- **Warm transfer:**
  - With a transfer number set, a caller who asks for a person is dialled
    through. Whoever answers first hears a whisper: who is calling and why.
  - If nobody answers, the caller is told someone will call back and a
    follow-up is created.
  - Without a transfer number, it takes a message.
- **Safety rails:**
  - AI disclosure and recording notice in the greeting.
  - Emergencies are escalated.
  - Repeated lines end the call politely instead of looping.
  - "Never mind, bye" ends the call rather than being taken as a message.
  - The spending cap declines new calls politely.
- **Playbook from graded calls** (Settings → Receptionist playbook):
  - Drafts the technique of the best-graded calls: common questions, how the
    best reps phrase each step, how they handle objections.
  - Names, companies, contact details and prices are stripped, first by
    instruction and then by checking against every name seen in the calls.
  - A manager edits and publishes it. Only the published version reaches live
    calls.
- **Every call is recorded** in stereo, uploaded at hang-up, and graded on the
  same scorecard. The AI appears as a rep ("AI Receptionist") for comparison.

---

## 9. Data model

| Table | Holds |
|---|---|
| `businesses` | Name, time zone, hours, transfer number, Twilio number, voice, greeting |
| `users` | Email, bcrypt hash, role (operator, admin, viewer) |
| `calls` | Upload or phone call. Audio path, fingerprint, channels, duration, when it happened, recording expiry, processing status and error, transcription engine and provider, segments (JSONB), denormalised call type / rep / score / grade for fast filtering, manual rep and call-type overrides, lead, cost |
| `call_analyses` | One per call. Models, scoring mode, prompt version, call type and confidence, outcome, names, summary, scorecard, score, grade, evidence verified %, triage (JSONB), step items (JSONB), coaching (JSONB), manager overrides (JSONB), cost |
| `reps` | Identified from greetings; first names normalised (Michelle = Michelle S.) |
| `leads` | Customer, stage, stage source (auto or manual), pests, service, price, next step, last contact |
| `follow_ups` | Action, owner, due, status, done by/at, assignee |
| `receptionist_playbooks` | Draft and published playbook per business |
| `appointments`, `kb_documents`, `kb_chunks` | Receptionist bookings and knowledge base (pgvector) |
| `cost_entries` | Every paid interaction: provider, units, cost. Backs the spending cap and per-call cost |
| `platform_settings` | Dashboard-set configuration. Secrets as AES-GCM envelopes |

Migrations: `app/alembic/versions/0001` → `0009`.

---

## 10. API

Served under `/api`, JSON with bearer tokens.

| Group | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password` |
| Calls | `POST /intel/uploads`, `GET /intel/calls` (filters: type, lens, rep, grade, status, review, disputed, source, q; sort and order; paging), `GET/PATCH/DELETE /intel/calls/{id}`, `POST /intel/calls/{id}/reprocess`, `GET /intel/calls/{id}/audio` (signed URL), `PUT /intel/calls/{id}/items/{key}/override` |
| Insights | `GET /intel/overview`, `GET /intel/reps`, `GET /intel/reps/{id}`, `GET /intel/pipeline`, `PATCH /intel/leads/{id}` |
| Owner views (v2) | `GET /intel/v2/brief` (verdict, three area cards, quality, prioritised to-do, coaching focus, AI agreement score; `days` filter), `GET /intel/v2/pipeline` (open leads with an owner action and urgency, decided leads, summary), `GET /intel/v2/reps`, `GET /intel/v2/reps/{id}` (strengths, focus, coaching tip, examples, calls) |
| Follow-ups | `GET /intel/follow-ups`, `PATCH /intel/follow-ups/{id}`, `GET /intel/team` |
| Settings | `GET/PATCH /settings` (business), `GET/PUT /settings/platform`, `GET /settings/models`, `GET /settings/spend`, `POST /settings/twilio/connect`, receptionist playbook endpoints, users, `POST /settings/digest/test` |
| Webhooks | `POST /webhooks/twilio`, `/twilio/status`, `/twilio/stream-ended/{id}`, `/twilio/whisper/{id}`, `/twilio/transfer-done/{id}` (all Twilio-signature verified) |
| Internal | `/internal/turn`, `/stt`, `/tts`, `/recording`, `/hangup` (voice container only, shared-token auth) |
| Health | `GET /health`; `GET /health/deep` (signed in) |

Interactive docs (`/docs`) are served in development only.

---

## 11. Security and privacy

- **The recordings are real customer calls.**
  - They are never committed (`*.mp3` and `data/` are ignored) and never
    publicly reachable. Audio is served only through short-lived signed URLs
    to a signed-in user.
  - They are used only to produce this analysis.
- **Retention:** each recording carries its own expiry (90 days by default). A
  sweep deletes the file and keeps the transcript and score until the
  transcript's own expiry (365 days). Deleting a call removes its recording,
  transcript and analysis immediately.
- **Secrets:**
  - API keys set in the dashboard are stored AES-GCM encrypted and are
    write-only: the UI shows only whether a key is set.
  - Per-business credentials bind the business ID as authenticated data, so
    a ciphertext copied between rows won't decrypt.
- **Access:**
  - Admin and view-only roles. View-only is enforced server-side by
    middleware, so a new write endpoint is read-only for viewers by default.
  - Sign-in is throttled: 5 failures lock an account for 15 minutes, 20 lock
    an address.
- **Transport and headers:**
  - TLS via Caddy.
  - HSTS, and a Content-Security-Policy that allows only same-origin scripts,
    styles and media plus Google Fonts.
  - `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, and a
    permissions policy.
  - No public API schema.
- **Webhooks:** every Twilio request is verified by HMAC signature against the
  public URL.
- **Error reporting** (optional Sentry) never includes request bodies, local
  variables or personal data. Dashboard errors are forwarded through a
  rate-limited endpoint.

---

## 12. Cost control

- Every paid call (transcription, language model, speech, telephony) is written
  to the cost ledger. Per-call cost is shown on the call.
- **Daily spending cap** (Settings; `DAILY_SPEND_CAP_USD`):
  - Once reached, paid providers are refused until the next UTC day.
  - Uploads queue but wait.
  - The receptionist politely declines calls.
- Transcripts are reused when re-scoring. Only the first Standard run writes
  coaching. Duplicate uploads are skipped.
- Typical cost on the sample calls: about **$0.40–0.46 per call** for Enhanced
  scoring (two models with deliberation), plus Deepgram transcription at a
  fraction of a cent per minute.

---

## 13. Running it

Requires Docker.

```bash
make env          # creates .env with generated secrets
# add CLAUDE_API_KEY (and optionally DEEPGRAM_API_KEY, OPENAI_API_KEY) to .env,
# or add them later in Settings
make up           # builds and starts everything
make seed         # creates the business and the first admin user (printed once)
make receptionist # optional: hours and FAQ for the demo receptionist
```

Open `https://localhost` (or your `SITE_DOMAIN`) and sign in. Upload from
**Calls → Upload**, or queue a folder:

```bash
make import dir=/path/to/recordings
```

| Command | Does |
|---|---|
| `make up` / `make down` | Start or stop the stack |
| `make logs s=app` | Tail one service |
| `make psql` | Database shell |
| `make test` | Backend tests |
| `make dev` | Database, Redis and worker only, for running the API and dashboard natively |

Running natively for development:

```bash
make dev
cd app && uv venv --python 3.12 .venv && uv pip install -e ".[dev]"
alembic upgrade head && python -m callsentry.scripts.seed
uvicorn callsentry.main:app --port 8000
cd ../dashboard && npm ci && NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

---

## 14. Configuration

Server configuration lives in `.env` (see `.env.example`). Most of it can also
be changed in **Settings**, which overrides `.env` at runtime without a
restart. Boot-time infrastructure is deliberately not editable from the web:
database and Redis URLs, the encryption key, the JWT secret and the internal
token.

| Setting | Default | Notes |
|---|---|---|
| `SITE_DOMAIN`, `PUBLIC_BASE_URL`, `PUBLIC_WS_URL` | localhost | Public hostname; Twilio signs against these |
| `CLAUDE_API_KEY`, `OPENAI_API_KEY`, `DEEPGRAM_API_KEY` | — | Also settable in Settings |
| `CALL_INTEL_MODEL` | `claude-sonnet-5` | Scoring model. The list in Settings is fetched live from each provider |
| `SCORING_MODE` / second model | standard | `enhanced` adds the second-opinion model |
| `INTEL_SCORING_RUNS` | 3 | Standard-mode runs per call |
| `INTEL_WORKERS` | 2 | Calls processed in parallel |
| `CALL_STT_ENGINE` | auto | auto, deepgram or local. Each upload can override it |
| `WHISPER_MODEL` | `small.en` | Local transcription model |
| `DAILY_SPEND_CAP_USD` | 20 | 0 disables the cap |
| `RECORDING_RETENTION_DAYS` / transcripts | 90 / 365 | |
| `TWILIO_*`, `SMS_CONFIRMATIONS` | — | Receptionist; **Connect number** in Settings sets the webhooks |
| Weekly digest, `SMTP_*` | off | Monday 8am, business time |
| `GOAL_CLOSE_RATE`, `GOAL_SAVE_RATE`, `GOAL_FIX_RATE`, `GOAL_CALL_STEPS` | 50 / 60 / 85 / 85 | v2 goals (%), editable in Settings → Goals. Below a goal reads *Could be better*; 15 points below, *Needs work* |
| `SENTRY_DSN` | — | Optional error reporting |
| `CALLSENTRY_LOCAL_ONLY` | 0 | 1 = never call a paid API |

---

## 15. Deployment and operations

**Server:**
- Ubuntu 24.04, Docker Compose (project `pestlaunch`).
- Only ports 80 and 443 are open (ufw).
- Cloudflare DNS in front of Caddy.
- Configuration in `/opt/pestlaunch/.env`.

**CI/CD** (`.github/workflows/ci.yml`), on every push to `main`:

| Job | Runs on | Does |
|---|---|---|
| `api` | GitHub-hosted | ruff, pytest |
| `voice` | GitHub-hosted | voice pipeline tests |
| `dashboard` | GitHub-hosted | TypeScript check, production build |
| `e2e` | GitHub-hosted, with real Postgres and Redis | seeds an admin and a synthetic call, runs Playwright |
| `deploy` | self-hosted runner on the server | needs all four; stamps the version and commit, rebuilds changed services, reloads Caddy |

Pull requests are tested but never deployed. The dashboard shows a notice when
a newer build is live.

**Operations:**
- **Backups:** `ops/install-backup.sh` installs a nightly (03:15 UTC) dump of
  the database and recordings to `/var/backups/pestlaunch`, kept 7 days. It
  prints the restore command.
- **Health:** `.github/workflows/health.yml` checks the API and dashboard every
  15 minutes; a failure emails the repository owner. `/health/deep` checks the
  database and each provider.
- **Migrations** run on API start.
- **Automatic restarts** by OS updates (`needrestart`) exclude Docker and the
  runner, so a security update can't cancel a deploy.

---

## 16. Testing

| Suite | Count | Covers |
|---|---|---|
| Backend (`app/tests`) | 302 | See below |
| Voice pipeline (`pipecat/tests`) | 25 | μ-law codec against a reference, endpointing, turn serialisation |
| Browser (`dashboard/e2e`) | 24 | v2 owner views, v1→v2 links, v1 review flow, sign-in |

**Backend tests cover what is silent when wrong:**
- grade thresholds and automatic awards
- majority voting and deliberation outcomes
- quote verification and speaker attribution
- transcript parsing and override recomputation
- every structured-output schema, and that every route is mounted
- viewer read-only enforcement and encryption bindings
- rate limits
- receptionist conversation guards, transfer TwiML and digest content
- v2 judgement:
  - areas judged against editable goals, and not judged under 3 calls
  - the headline names every area behind target
  - the coaching focus and tip selection
  - lead actions and urgency, with no action once decided
  - placeholder names treated as no name
  - the AI agreement score counts only the AI's own verdicts on corrected calls
- scoring across call types: voicemails never graded, a manager's call type
  reaches triage, rulings stay on their own scorecard, cancellation steps
  coached apart, tips only from calls where the step was missed

**Browser tests (v2)** run on made-up data, never real calls:
- Today shows the verdict, three areas and the top three actions
- *Said yes* moves a lead at once and Undo restores it; a failed save rolls
  back and says so
- no caller is ever shown as "unknown"
- the call page folds detail behind one tap, and its ••• menu works by
  keyboard
- a failed delete reports itself; a broken link explains itself
- a person's page says what to teach, with the words and a moment to hear
- All calls follows the period picker and the filters linked from Today and
  Team, and each one clears
- search follows typing and can be cleared
- nothing spills sideways at phone width
- pest names are cleaned; the opening line is built correctly
- an **axe WCAG 2.1 AA check** of every v2 page in light and dark mode

**Browser tests (v1 and sign-in):**
- signing in opens v2
- every v1 page links to its v2 twin
- a wrong password is refused
- a synthetic call is reviewed end to end: disputed-step filter, manager
  override changes the score, follow-up stays ticked after reload

```bash
make test                                        # backend
cd pipecat && python -m pytest -q tests          # voice
cd dashboard && npm run build && npx next start -p 3100 &
E2E_BASE_URL=http://localhost:3100 npx playwright test v2 v1-banner   # v2, no server needed
E2E_EMAIL=… E2E_PASSWORD=… npx playwright test                       # all, against a running API
```

---

## 17. Results on the sample calls

The 20 supplied recordings plus one receptionist call, as graded in production
with Enhanced scoring:

| | |
|---|---|
| Call types | 13 sales, 4 scheduling, 2 re-service, 1 retention, 1 other service |
| Grades | All below standard (average 46% of steps on uploads) |
| Evidence verified | 100% of cited quotes found in the transcript |
| Step agreement (286 step verdicts) | 227 both models agreed; 19 settled after deliberating; 27 disputed (left for a manager); 32 decided by a manual rule |
| Cost | about $0.46 per call (Enhanced) |

The low grades reflect how strict the manuals' checklists are, not a scoring
error. Gold on the sales scorecard needs all 17 steps. The most-missed steps
across the calls are:

- *Thank the Customer*
- *Expectation Statement* (Understand)
- *Offer Final Information*
- *Summary Statement*

These are the coaching priorities Today (v2) and the Overview (v1) surface.

---

## 18. Known limitations

- **Mono recordings rely on attribution by content.** When two people talk
  over each other in one sentence, that sentence goes to one of them.
- **No call metadata in the recordings.** The call date is the file's modified
  time (editable), and reps are identified from their greeting. A rep who
  never says their name isn't attributed, but can be assigned by hand.
- **Pipeline matching is by customer name.** Two customers with the same name
  share a lead.
- **Borderline and disputed steps** are where the models are least certain;
  they're the ones worth a manager's listen.
- **The receptionist's replies take 2–4 seconds** to start (intent detection
  plus answer). It answers only from its FAQ, so anything outside it becomes a
  message or a transfer.
- **v2's suggested opening lines repeat what the analysis found.** If a name
  or price was transcribed wrong, the line repeats the mistake, so a quick look
  before calling is worthwhile.
- **v2's goals are starting points** for a typical pest control office, not
  this company's own targets, until someone changes them in Settings.
- **Average scores depend a little on call mix.** Steps the manual awards
  automatically (no objections on a sales call) count toward a person's
  percentage, so someone taking more sales calls starts slightly higher.
  Coaching and focus steps leave those points out.
- **Single-tenant deployment.** The data model is multi-business, but
  onboarding a second business is done from the command line.

## 19. What's next

- Pull calls, reps and customers from the CRM (FieldRoutes, PestPac,
  GorillaDesk) instead of uploading, so dates, reps and accounts are exact.
- Feed assigned follow-ups into PestLaunch Tasks.
- **Custom scorecards per company.** Start from the PestLaunch standard, or
  have the AI draft one from a company's own manual, then add, edit or remove
  steps and set the grade cut-offs. Each analysis keeps the version it was
  graded on, so editing a scorecard never changes past grades.
- **Fix who said a line** on mono calls (swap speaker, split a line), then
  re-score. That's where mono recordings are weakest.
- Use managers' corrections to tune step criteria per company. The agreement
  score (v2 Today) shows where to start: the steps managers change most.
- Trends per rep and per step over time as call history grows.
- Company-specific scripts and pricing as scoring context.
- Stream the receptionist's reply to speech as it's generated, to cut response
  time.

---

## 20. Repository layout

```
app/                         FastAPI service
  callsentry/
    intel/                   call intelligence
      rubrics.py             scorecards, criteria, grade thresholds
      ingest.py              upload validation, fingerprinting, storage
      jobs.py                database-backed queue and workers
      transcribe.py          Deepgram / Whisper, speaker handling
      transcript.py          segments, quote verification
      analyze.py             triage, scoring, consensus, deliberation, manual rules
      overrides.py           manager step overrides
      pipeline.py            one call end to end
      insights.py            overview, reps, training aggregates
      brief.py               v2 owner views: verdicts, actions, coaching, plain names
      leads.py               sales pipeline
      followups.py           follow-up extraction
      playbook.py            receptionist playbook from graded calls
    agents/                  receptionist: voice agent, intents, knowledge base, booking
    api/routes/              REST, webhooks, internal voice endpoints
    services/                LLM, speech, spend cap, settings, digest, retention, rate limits
    core/                    database, provider registry, encryption
    models/                  SQLAlchemy models
    scripts/                 seed, import, receptionist demo, e2e fixture
  alembic/                   migrations 0001-0009
  tests/
dashboard/                   Next.js 15
  app/v2/                    v2: Today, Call back, Team, All calls, call and person pages
  app/calls/                 v1: Overview, Pipeline, Reps, Call Log, call detail
  components/v2/             v2 kit: status, meters, menus, toasts, player, text size
  app/settings/              Settings
  components/                shell, UI kit, progress bar, error reporter
  e2e/                       Playwright (v2 runs on made-up data, with axe checks)
  lib/v2.ts                  v2 types, status words, plain names and pest names
pipecat/                     receptionist voice transport and recording
worker/                      faster-whisper service
caddy/                       reverse proxy, TLS, security headers
ops/                         backups
.github/workflows/           CI/CD and health checks
```
