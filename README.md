# PestLaunch Call Intelligence

Upload a pest control company's call recordings and get, for every call:

- a transcript with the rep and the customer told apart
- the call type (sales, retention, re-service, scheduling, billing, other)
- what happened: outcome, price quoted, objections, cancel reason, follow-ups
- the PestLaunch scorecard grade, step by step, with the quote that earned or lost each point
- coaching for the rep, anchored to moments in the recording

And across all calls: close rate, saves, resolution, what to train on, a sales
pipeline that fills itself, and a breakdown by rep.

It also includes an **AI receptionist**. Call the demo number, ask a question or
book an inspection; when you hang up, the recording goes through the same
pipeline and appears in the Call Log, graded against the same scorecard.

---

## How it works

```
upload ─► queue (calls table) ─► transcribe ─► triage ─► score ×3 ─► store
                                     │            │          │
                          Deepgram or Whisper   Claude     Claude
```

1. **Transcribe.** Deepgram Nova-3 or local Whisper (faster-whisper), chosen per
   upload. Stereo recordings are split by channel, which separates rep and
   customer exactly. On mono phone audio, acoustic speaker separation is
   unreliable, so each sentence is attributed to the rep or the customer from
   the conversation itself.
2. **Triage.** One pass identifies the rep (from their greeting), the call type,
   and the details each view needs: sales outcome and objections, cancel reason
   and save offers, service resolution, follow-ups owed.
3. **Score.** The call is graded against the scorecard for its type - the
   12-step call process, the 12-step retention process, or the 17-step sales
   process - three times independently. Each step takes the majority verdict;
   steps where the passes disagree are shown as *borderline*.
4. **Decide in code.** The model judges individual steps. Scorecard selection,
   the automatic awards in the manuals (all four objection points on a sales
   call with no objections; *Repeat* when the first save offer is accepted),
   totals, grade thresholds and timestamps are computed in code.

### Why the grades can be trusted

- Every point cites a quote from the transcript by line number. Each quote is
  checked against that line; the timestamp comes from the transcript, never
  from the model. Quotes that cannot be found are flagged.
- Three independent scoring passes remove most run-to-run variance on
  borderline steps.
- Calls whose type is unclear are marked **Check type**; a manager confirms or
  changes the type and the call is re-graded on the right scorecard.
- Failures are visible. A call that cannot be transcribed or scored says why
  and can be retried; nothing is silently skipped.

---

## Run it

Requires Docker.

```bash
make env          # creates .env with generated secrets
# add CLAUDE_API_KEY and DEEPGRAM_API_KEY to .env
make up           # builds and starts everything
make seed         # creates the business and the first admin user
```

Open `https://localhost` (or the `SITE_DOMAIN` you set) and sign in with the
admin printed by `make seed`.

Upload recordings from the **Upload calls** button, or queue a folder:

```bash
make import dir=/path/to/recordings
```

### Settings, environments and spending

- **Settings** holds the API keys (Claude, Deepgram, Twilio), the scoring model,
  the default transcription engine and the daily spending cap. Keys are stored
  encrypted and are write-only: the dashboard shows whether a key is set, never
  the key. Values saved here override the server's `.env`.
- **Environments.** After signing in you choose **Cloud** (Deepgram
  transcription, seconds per call) or **Local** (Whisper on the server; the audio
  is never sent to a transcription service, and transcription takes about a
  fifth of the call's length). Scoring uses Claude in both.
- **Spending cap.** Every paid interaction is written to a cost ledger. Once
  today's total reaches `DAILY_SPEND_CAP_USD` ($20 by default), paid providers
  are refused until the next UTC day and the receptionist politely declines
  calls.

### Scoring models

The scoring model is picked in Settings from a list fetched live from Anthropic
and OpenAI. **Standard** scoring runs that model three times and takes the
majority per step; only the first run writes coaching, which keeps output
tokens down. **Enhanced** scoring has the scoring model and a second-opinion
model from the other provider grade independently, then shows each the other's
verdict and evidence on every step they disagree on. Steps still disputed
after that second round are marked *Disputed* and not awarded.

### The AI receptionist

1. In **Settings**, add the Twilio account SID, auth token and phone number, save,
   then press **Connect number**. That points the number's webhooks at this site.
2. `make receptionist` loads business hours and a short FAQ built only from facts
   in the call manuals. The receptionist answers from that FAQ or offers to take a
   message; it never improvises prices or policies.
3. Optionally, **Settings → Receptionist playbook → Generate from calls** drafts
   a playbook of technique from your graded calls: the questions callers ask,
   how the best reps phrase each step of the call process, and how they handle
   objections. Names, companies, contact details and prices are stripped, first
   by instruction and then by a check against every name seen in the calls. A
   manager edits and publishes it; only the published version is used.
4. Callers who have phoned the receptionist before are greeted by first name,
   and it knows what they called about last time.
5. Call the number. Live calls always use cloud speech (Deepgram) and Claude,
   because local speech on a CPU is too slow for conversation. Appointments are
   booked into two-hour arrival windows within business hours.

### Deploying

Set `SITE_DOMAIN` to a hostname that points at the server; Caddy obtains the
TLS certificate. Only ports 80 and 443 are published.

Pushes to `main` are tested on GitHub-hosted runners and then deployed by a
self-hosted runner on the server (`.github/workflows/ci.yml`). The server keeps
its configuration in `/opt/pestlaunch/.env`.

---

## Layout

```
app/          FastAPI - API, job runner, analysis
  callsentry/intel/
    rubrics.py      scorecards, grade thresholds
    transcribe.py   Deepgram / Whisper, speaker handling
    analyze.py      triage, scoring, consensus, manual rules
    transcript.py   segments, quote verification
    pipeline.py     one call end to end
    jobs.py         database-backed queue
    insights.py     overview, reps, training aggregates
    leads.py        sales pipeline
dashboard/    Next.js - Calls (Overview, Pipeline, Reps, Call Log, call detail), Settings
pipecat/      AI receptionist voice pipeline
worker/       Whisper transcription over HTTP
caddy/        reverse proxy and TLS
```

The AI receptionist lives in `pipecat/` (Twilio media streams, turn detection,
stereo call recording) and `app/callsentry/agents/` (conversation, knowledge
base, booking). Speech and language go through the API's provider registry, so
the spending cap and cost ledger cover live calls too.

---

## Tests

```bash
make test
```

The suite covers what is silent when wrong: grade thresholds, automatic awards,
majority voting, quote verification, speaker attribution, transcript parsing,
the shape of every structured-output schema, and that every route is mounted.

---

## Known limitations

- **Mono recordings rely on attribution by content.** When two people talk over
  each other in one sentence, that sentence is given to one of them.
- **Call dates.** Recordings carry no call date or rep list, so dates are the
  upload time and reps are identified from their greeting. A rep who never
  says their name is not attributed.
- **Pipeline matching is by customer name.** Two customers with the same name
  share a lead; a caller who never gives a name gets a lead of their own.
- **Borderline steps.** Majority voting makes grades stable, not infallible;
  borderline steps are the ones worth a manager's listen.

## What's next

- Pull calls, reps and customers straight from the CRM (FieldRoutes, GorillaDesk,
  PestPac) instead of uploading, so dates, reps and accounts are exact.
- Turn follow-ups into assignable tasks in PestLaunch Tasks.
- Let managers dispute a step; use disputes to tune the rubric per company.
- Trends over time per rep and per step once there is enough call history.
- Company-specific scripts and pricing as scoring context.
