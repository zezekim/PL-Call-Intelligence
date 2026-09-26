# PestLaunch Call Intelligence

Upload a pest control company's call recordings and get, for every call:

- a transcript with the rep and the customer told apart
- the call type (sales, retention, re-service, scheduling, billing, other)
- what happened: outcome, price quoted, objections, cancel reason, follow-ups
- the PestLaunch scorecard grade, step by step, with the quote that earned or lost each point
- coaching for the rep, anchored to moments in the recording

And across all calls: close rate, saves, resolution, what to train on, a sales
pipeline that fills itself, and a breakdown by rep.

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
dashboard/    Next.js - Calls: Overview, Pipeline, Reps, Call Log, call detail
worker/       Whisper transcription over HTTP
caddy/        reverse proxy and TLS
```

The repository also contains a live AI voice receptionist (Twilio media
streams in `pipecat/`, conversation logic in `app/callsentry/agents/`). It is
not needed for call intelligence and stays off unless started with
`docker compose --profile receptionist up -d`.

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
