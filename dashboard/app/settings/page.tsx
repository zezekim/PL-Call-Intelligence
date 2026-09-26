"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { setBusinessZone } from "@/lib/format";
import { type Theme, getTheme, setTheme } from "@/lib/theme";
import { useApi, useTitle } from "@/lib/hooks";
import { AlertIcon, CheckIcon } from "@/components/icons";
import { ErrorNote, Loading, Modal, Segmented, Spinner } from "@/components/ui";

interface Field {
  key: string;
  label: string;
  kind: "text" | "secret" | "bool" | "int" | "float" | "url";
  help: string;
  value: string;
  is_set: boolean;
  overridden: boolean;
}

interface Platform {
  can_edit: boolean;
  fields: Field[];
}

interface Spend {
  spent_today_usd: number;
  cap_usd: number;
}

const SECTIONS: { title: string; description: string; keys: string[] }[] = [
  {
    title: "Call scoring",
    description:
      "The scoring model classifies every call, grades it against the scorecard and writes the coaching. " +
      "Enhanced scoring adds a second model from the other provider; they deliberate on any step they disagree on.",
    keys: [
      "claude_api_key",
      "openai_api_key",
      "call_intel_model",
      "scoring_mode",
      "enhanced_second_model",
    ],
  },
  {
    title: "Transcription",
    description: "Deepgram transcribes calls in the Cloud environment and powers the receptionist's voice.",
    keys: ["deepgram_api_key", "call_stt_engine"],
  },
  {
    title: "AI receptionist",
    description: "The Twilio number callers dial. Connect it after saving the credentials.",
    keys: ["twilio_account_sid", "twilio_auth_token", "twilio_phone_number", "sms_confirmations"],
  },
  {
    title: "Weekly digest",
    description:
      "A Monday-morning email with last week's scores, open follow-ups and what to coach on. " +
      "Nothing is sent until an SMTP server and recipients are set and the digest is switched on.",
    keys: [
      "weekly_digest",
      "digest_recipients",
      "smtp_host",
      "smtp_port",
      "smtp_username",
      "smtp_password",
      "smtp_from",
    ],
  },
  {
    title: "Spending",
    description: "Paid services pause for the rest of the day once the cap is reached.",
    keys: ["daily_spend_cap_usd"],
  },
];

const MODE_CHOICES = [
  { value: "standard", label: "Standard" },
  { value: "enhanced", label: "Enhanced (two models)" },
];

interface ModelList {
  anthropic: { id: string; name: string }[];
  openai: { id: string; name: string }[];
  errors: Record<string, string>;
}

const ENGINE_CHOICES = [
  { value: "auto", label: "Automatic (Deepgram, local fallback)" },
  { value: "deepgram", label: "Deepgram" },
  { value: "local", label: "Local" },
];

export default function SettingsPage() {
  useTitle("Settings");
  const { data, error, loading, setData } = useApi<Platform>("/settings/platform");
  const spend = useApi<Spend>("/settings/spend");
  const models = useApi<ModelList>("/settings/models");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const byKey = useMemo(() => {
    const map: Record<string, Field> = {};
    (data?.fields ?? []).forEach((f) => (map[f.key] = f));
    return map;
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return null;

  const dirty = Object.keys(edits).length > 0;
  const setEdit = (key: string, value: string | null) => {
    setSaved(false);
    setEdits((prev) => {
      const next = { ...prev };
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await api.put<Platform>("/settings/platform", { values: edits });
      setData(result);
      setEdits({});
      setSaved(true);
      setConfirming(false);
      void spend.reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <div>
          <h1 className="large-title">Settings</h1>
          <p className="footnote mt-1.5">
            Keys are stored encrypted and can only be replaced, never viewed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="inline-flex items-center gap-1 text-[14px] text-good">
              <CheckIcon className="h-4 w-4" /> Saved
            </span>
          )}
          {dirty && (
            <button className="btn-secondary" onClick={() => setEdits({})}>
              Discard
            </button>
          )}
          <button
            className="btn-primary"
            disabled={!dirty || !data.can_edit}
            onClick={() => setConfirming(true)}
          >
            Save changes
          </button>
        </div>
      </div>

      {!data.can_edit && <ErrorNote message="Only an admin can change these settings." />}

      <BusinessPanel canEdit={data.can_edit} />

      {SECTIONS.map((section) => (
        <section key={section.title} className="pt-3">
          <h2 className="section-title px-1">{section.title}</h2>
          <p className="footnote mb-3 mt-1 max-w-2xl px-1">{section.description}</p>
          <div className="group-list px-5">
            {section.keys.map((key) =>
              byKey[key] ? (
                <FieldRow
                  key={key}
                  field={byKey[key]}
                  edit={edits[key]}
                  onEdit={(v) => setEdit(key, v)}
                  disabled={!data.can_edit}
                  models={models.data}
                />
              ) : null,
            )}
          </div>
          {section.title === "AI receptionist" && <ConnectNumber disabled={dirty || !data.can_edit} />}
          {section.title === "Weekly digest" && <DigestTest disabled={dirty || !data.can_edit} />}
          {section.title === "Spending" && spend.data && (
            <SpendMeter spent={spend.data.spent_today_usd} cap={spend.data.cap_usd} />
          )}
        </section>
      ))}

      <PlaybookPanel canEdit={data.can_edit} />
      <TeamPanel canEdit={data.can_edit} />
      <AccountPanel />
      <AppearancePanel />

      <Modal open={confirming} onClose={() => !saving && setConfirming(false)} title="Save these changes?">
        <div className="flex gap-3 rounded-2xl bg-warn-soft p-4 text-[14px] leading-snug">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <p>
            Changing these settings can break the demo. A wrong or missing key stops calls from
            being transcribed, scored or answered until it is fixed.
          </p>
        </div>
        <ul className="mt-4 space-y-1.5 text-[14px]">
          {Object.keys(edits).map((k) => (
            <li key={k} className="flex justify-between gap-3">
              <span>{byKey[k]?.label ?? k}</span>
              <span className="text-muted">
                {edits[k] === "" ? "Reset to server default" : byKey[k]?.kind === "secret" ? "Replaced" : edits[k]}
              </span>
            </li>
          ))}
        </ul>
        {saveError && (
          <div className="mt-3">
            <ErrorNote message={saveError} />
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setConfirming(false)} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving && <Spinner className="h-3.5 w-3.5" />}
            Save anyway
          </button>
        </div>
      </Modal>
    </div>
  );
}

function FieldRow({
  field,
  edit,
  onEdit,
  disabled,
  models,
}: {
  field: Field;
  edit: string | undefined;
  onEdit: (value: string | null) => void;
  disabled: boolean;
  models: ModelList | null;
}) {
  const [replacing, setReplacing] = useState(false);
  const editing = edit !== undefined;

  let control: React.ReactNode;
  if (field.kind === "secret") {
    control =
      replacing || (editing && edit !== "") ? (
        <div className="flex gap-2">
          <input
            type="password"
            autoComplete="new-password"
            className="input"
            placeholder="Paste the new value"
            aria-label={field.label}
            value={edit ?? ""}
            onChange={(e) => onEdit(e.target.value || null)}
            disabled={disabled}
          />
          <button
            className="btn-ghost"
            onClick={() => {
              setReplacing(false);
              onEdit(null);
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-[14px] ${field.is_set ? "text-ink" : "text-muted"}`}>
            <span className={`h-[7px] w-[7px] rounded-full ${field.is_set ? "bg-[#34c759]" : "bg-neutral"}`} />
            {field.is_set ? "Set" : "Not set"}
          </span>
          {edit === "" && <span className="chip bg-warn-soft text-warn">Will reset</span>}
          <button className="btn-secondary ml-auto px-3 py-1" onClick={() => setReplacing(true)} disabled={disabled}>
            {field.is_set ? "Replace" : "Add"}
          </button>
          {field.overridden && edit !== "" && (
            <button className="btn-ghost px-3 py-1" onClick={() => onEdit("")} disabled={disabled}>
              Reset to server default
            </button>
          )}
        </div>
      );
  } else if (field.kind === "bool") {
    const current = (edit ?? field.value) === "true";
    control = (
      <label className="inline-flex cursor-pointer items-center gap-2 text-[14px]">
        <input
          type="checkbox"
          aria-label={field.label}
          className="h-4 w-4 accent-[#0071e3]"
          checked={current}
          onChange={(e) => onEdit(e.target.checked === (field.value === "true") ? null : String(e.target.checked))}
          disabled={disabled}
        />
        {current ? "On" : "Off"}
      </label>
    );
  } else if (field.key === "call_intel_model" || field.key === "enhanced_second_model") {
    control = <ModelPicker field={field} edit={edit} onEdit={onEdit} disabled={disabled} models={models} />;
  } else if (field.key === "scoring_mode") {
    control = (
      <select
        aria-label={field.label}
        className="select w-full sm:max-w-[300px]"
        value={edit ?? field.value}
        onChange={(e) => onEdit(e.target.value === field.value ? null : e.target.value)}
        disabled={disabled}
      >
        {MODE_CHOICES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    );
  } else if (field.key === "call_stt_engine") {
    control = (
      <select
        aria-label={field.label}
        className="select w-full sm:max-w-[300px]"
        value={edit ?? field.value}
        onChange={(e) => onEdit(e.target.value === field.value ? null : e.target.value)}
        disabled={disabled}
      >
        {ENGINE_CHOICES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <input
        aria-label={field.label}
        className="input w-full sm:max-w-[300px]"
        inputMode={field.kind === "float" || field.kind === "int" ? "decimal" : undefined}
        value={edit ?? field.value}
        onChange={(e) => onEdit(e.target.value === field.value ? null : e.target.value)}
        disabled={disabled}
      />
    );
  }

  return (
    <div className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:items-center sm:gap-8">
      <div>
        <p className="text-[15px]">{field.label}</p>
        {field.help && <p className="mt-0.5 text-[12px] leading-snug text-muted">{field.help}</p>}
      </div>
      <div className="flex sm:justify-end">{control}</div>
    </div>
  );
}

function ModelPicker({
  field,
  edit,
  onEdit,
  disabled,
  models,
}: {
  field: Field;
  edit: string | undefined;
  onEdit: (value: string | null) => void;
  disabled: boolean;
  models: ModelList | null;
}) {
  const value = edit ?? field.value;
  const known = new Set([...(models?.anthropic ?? []), ...(models?.openai ?? [])].map((m) => m.id));
  const errors = Object.entries(models?.errors ?? {});
  return (
    <div className="w-full space-y-1.5 sm:max-w-[300px]">
      <select
        aria-label={field.label}
        className="select"
        value={value}
        onChange={(e) => onEdit(e.target.value === field.value ? null : e.target.value)}
        disabled={disabled || !models}
      >
        {!models && <option value={value}>{value || "Loading models"}</option>}
        {field.key === "enhanced_second_model" && <option value="">Not set</option>}
        {value && models && !known.has(value) && <option value={value}>{value} (current)</option>}
        {models && models.anthropic.length > 0 && (
          <optgroup label="Anthropic">
            {models.anthropic.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.id})
              </option>
            ))}
          </optgroup>
        )}
        {models && models.openai.length > 0 && (
          <optgroup label="OpenAI">
            {models.openai.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <p className="text-xs text-muted">
        Listed live from each provider, newest first.
        {models && !models.openai.length && !models.errors.openai && " Add an OpenAI key to list OpenAI models."}
      </p>
      {errors.map(([provider, message]) => (
        <p key={provider} className="text-xs text-bad">
          {provider === "openai" ? "OpenAI" : "Anthropic"}: {message}
        </p>
      ))}
    </div>
  );
}

function ConnectNumber({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-hairline bg-surface px-5 py-4">
      <div className="min-w-0 flex-1 text-[14px]">
        <p className="text-[15px]">Connect the number</p>
        <p className="text-muted">
          Points the Twilio number at this site so incoming calls reach the receptionist.
        </p>
        {result && <p className="mt-1 text-good">{result}</p>}
        {error && <p className="mt-1 text-bad">{error}</p>}
      </div>
      <button
        className="btn-primary"
        disabled={busy || disabled}
        title={disabled ? "Save your changes first" : undefined}
        onClick={async () => {
          setBusy(true);
          setError(null);
          setResult(null);
          try {
            const r = await api.post<{ phone_number: string }>("/settings/twilio/connect");
            setResult(`Connected. Calls to ${r.phone_number} now reach the receptionist.`);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not connect");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Spinner className="h-3.5 w-3.5" />}
        Connect number
      </button>
    </div>
  );
}

function SpendMeter({ spent, cap }: { spent: number; cap: number }) {
  const pctUsed = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const tone = pctUsed >= 100 ? "bg-[#ff3b30]" : pctUsed >= 75 ? "bg-[#ff9f0a]" : "bg-accent";
  return (
    <div className="mt-3 rounded-2xl border border-hairline bg-surface px-5 py-4">
      <div className="flex items-baseline justify-between text-[15px]">
        <span>Spent today</span>
        <span className="tnum">
          ${spent.toFixed(2)} {cap > 0 ? `of $${cap.toFixed(2)}` : "(no cap)"}
        </span>
      </div>
      {cap > 0 && (
        <div className="mt-2.5 h-[5px] rounded-full bg-fill" title={`${pctUsed.toFixed(0)}% of today's cap`}>
          <div className={`h-[5px] rounded-full ${tone}`} style={{ width: `${pctUsed}%` }} />
        </div>
      )}
      {pctUsed >= 100 && (
        <p className="mt-2 text-xs text-bad">Cap reached: paid services are paused until tomorrow (UTC).</p>
      )}
    </div>
  );
}


interface PlaybookVersion {
  content: string;
  source_calls: number;
  removed_items: number;
  updated_at: string;
}

interface Playbook {
  draft: PlaybookVersion | null;
  published: PlaybookVersion | null;
}

function PlaybookPanel({ canEdit }: { canEdit: boolean }) {
  const { data, setData, error } = useApi<Playbook>("/settings/receptionist/playbook");
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const draft = data?.draft ?? null;
  const published = data?.published ?? null;
  const value = text ?? draft?.content ?? "";
  const edited = text !== null && text !== (draft?.content ?? "");
  const live = published && draft && published.content === draft.content && !edited;

  async function run(label: string, action: () => Promise<Playbook>) {
    setBusy(label);
    setFailure(null);
    try {
      const result = await action();
      setData(result);
      setText(null);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="pt-3">
      <h2 className="section-title px-1">Receptionist playbook</h2>
      <p className="footnote mb-3 mt-1 max-w-2xl px-1">
        Technique learned from your graded calls: the questions callers ask, how your best reps
        phrase each step, and how they handle objections. Names, companies, contact details and
        prices are removed. Prices and policies still come only from the business FAQ. Review and
        edit before publishing.
      </p>
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[14px]">
            <span className="inline-flex items-center gap-1.5">
              <span className={`h-[7px] w-[7px] rounded-full ${published ? "bg-[#34c759]" : "bg-neutral"}`} />
              {published ? (live ? "Published - the receptionist is using this" : "Published version differs from this draft") : "Not published"}
            </span>
            {draft && (
              <p className="mt-0.5 text-[12px] text-muted">
                Learned from {draft.source_calls} graded calls
                {draft.removed_items ? ` · ${draft.removed_items} entries removed for privacy` : ""}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              disabled={!canEdit || !!busy}
              title="Reads every graded call once. Roughly $0.20-0.50 in model usage."
              onClick={() => run("generate", () => api.post<Playbook>("/settings/receptionist/playbook/generate"))}
            >
              {busy === "generate" && <Spinner className="h-3.5 w-3.5" />}
              {draft ? "Regenerate from calls" : "Generate from calls"}
            </button>
            {edited && (
              <button
                className="btn-secondary"
                disabled={!canEdit || !!busy}
                onClick={() => run("save", () => api.put<Playbook>("/settings/receptionist/playbook/draft", { content: value }))}
              >
                {busy === "save" && <Spinner className="h-3.5 w-3.5" />}
                Save draft
              </button>
            )}
            {draft && !edited && !live && (
              <button
                className="btn-primary"
                disabled={!canEdit || !!busy}
                onClick={() => run("publish", () => api.post<Playbook>("/settings/receptionist/playbook/publish"))}
              >
                {busy === "publish" && <Spinner className="h-3.5 w-3.5" />}
                Publish
              </button>
            )}
            {published && (
              <button
                className="btn-ghost"
                disabled={!canEdit || !!busy}
                onClick={() => run("unpublish", () => api.delete<Playbook>("/settings/receptionist/playbook/published"))}
              >
                Unpublish
              </button>
            )}
          </div>
        </div>
        {busy === "generate" && (
          <p className="mt-3 text-[13px] text-muted">Reading your calls. This takes about a minute.</p>
        )}
        {(failure || error) && (
          <div className="mt-3">
            <ErrorNote message={failure ?? error ?? ""} />
          </div>
        )}
        {draft && (
          <textarea
            className="input mt-4 min-h-[320px] font-mono text-[13px] leading-relaxed"
            value={value}
            onChange={(e) => setText(e.target.value)}
            disabled={!canEdit}
            spellCheck
          />
        )}
      </div>
    </section>
  );
}


interface TeamUser {
  id: string;
  email: string;
  role: string;
  created_at: string;
  is_current_user: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  viewer: "View only",
  operator: "Platform operator",
};

function TeamPanel({ canEdit }: { canEdit: boolean }) {
  const { data, reload, error } = useApi<TeamUser[]>("/settings/users");
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("admin");
  const [resetting, setResetting] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [removing, setRemoving] = useState<TeamUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, done: () => void) {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      done();
      await reload();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pt-3">
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <div>
          <h2 className="section-title">Team</h2>
          <p className="footnote mt-1">People who can sign in. View-only users can see everything but change nothing.</p>
        </div>
        {canEdit && !adding && (
          <button className="btn-secondary" onClick={() => setAdding(true)}>
            Add person
          </button>
        )}
      </div>
      {(failure || error) && (
        <div className="mb-3">
          <ErrorNote message={failure ?? error ?? ""} />
        </div>
      )}
      <div className="group-list">
        {adding && (
          <div className="grid gap-2 px-5 py-4 sm:grid-cols-[1.4fr_1fr_140px_auto]">
            <input className="input" type="email" placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="Temporary password (10+ characters)"
              aria-label="Temporary password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <select className="select" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">Admin</option>
              <option value="viewer">View only</option>
            </select>
            <div className="flex gap-2">
              <button
                className="btn-primary"
                disabled={busy || !email || password.length < 10}
                onClick={() =>
                  run(() => api.post("/settings/users", { email, password, role }), () => {
                    setAdding(false);
                    setEmail("");
                    setPassword("");
                  })
                }
              >
                Add
              </button>
              <button className="btn-ghost" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {(data ?? []).map((u) => (
          <div key={u.id} className="px-5 py-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px]">
                  {u.email}
                  {u.is_current_user && <span className="text-muted"> (you)</span>}
                </p>
                <p className="text-[12px] text-muted">{ROLE_LABEL[u.role] ?? u.role}</p>
              </div>
              {canEdit && !u.is_current_user && (
                <div className="flex gap-2">
                  <button className="btn-secondary px-3 py-1 text-[13px]" onClick={() => setResetting(resetting === u.id ? null : u.id)}>
                    Set password
                  </button>
                  <button className="btn-danger px-3 py-1 text-[13px]" onClick={() => setRemoving(u)}>
                    Remove
                  </button>
                </div>
              )}
            </div>
            {resetting === u.id && (
              <div className="mt-3 flex gap-2">
                <input
                  className="input max-w-xs"
                  type="password"
                  autoComplete="new-password"
                  placeholder="New password (10+ characters)"
                  aria-label="New password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <button
                  className="btn-primary"
                  disabled={busy || newPassword.length < 10}
                  onClick={() =>
                    run(() => api.put(`/settings/users/${u.id}/password`, { password: newPassword }), () => {
                      setResetting(null);
                      setNewPassword("");
                    })
                  }
                >
                  Save
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Remove this person?">
        <p className="text-[14px] text-muted">{removing?.email} will no longer be able to sign in.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setRemoving(null)}>
            Cancel
          </button>
          <button
            className="btn bg-bad text-white hover:bg-[#b0001a]"
            disabled={busy}
            onClick={() => removing && run(() => api.delete(`/settings/users/${removing.id}`), () => setRemoving(null))}
          >
            Remove
          </button>
        </div>
      </Modal>
    </section>
  );
}

function AccountPanel() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <section className="pt-3">
      <h2 className="section-title px-1">Your account</h2>
      <p className="footnote mb-3 mt-1 px-1">Change the password you sign in with.</p>
      <div className="card flex flex-wrap items-center gap-2 px-5 py-4">
        <input
          className="input max-w-[220px]"
          type="password"
          autoComplete="current-password"
          placeholder="Current password"
          aria-label="Current password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <input
          className="input max-w-[220px]"
          type="password"
          autoComplete="new-password"
          placeholder="New password (10+ characters)"
          aria-label="New password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <button
          className="btn-primary"
          disabled={busy || !current || next.length < 10}
          onClick={async () => {
            setBusy(true);
            setMessage(null);
            try {
              await api.post("/auth/change-password", { current_password: current, new_password: next });
              setCurrent("");
              setNext("");
              setMessage({ ok: true, text: "Password changed." });
            } catch (err) {
              setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not change password" });
            } finally {
              setBusy(false);
            }
          }}
        >
          Change password
        </button>
        {message && <p className={`w-full text-[13px] ${message.ok ? "text-good" : "text-bad"}`}>{message.text}</p>}
      </div>
    </section>
  );
}

interface BusinessSettings {
  name: string;
  timezone: string;
  escalation_phone: string | null;
}

const ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles"];
  }
})();

function BusinessPanel({ canEdit }: { canEdit: boolean }) {
  const { data, setData, error } = useApi<BusinessSettings>("/settings");
  const [edits, setEdits] = useState<Partial<BusinessSettings>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return null;

  const value = { ...data, ...edits };
  const dirty = Object.keys(edits).length > 0;
  const set = (key: keyof BusinessSettings, v: string) => {
    setMessage(null);
    setEdits((e) => {
      const next = { ...e, [key]: v };
      if ((data[key] ?? "") === v) delete next[key];
      return next;
    });
  };
  const zones = ZONES.includes(value.timezone) ? ZONES : [value.timezone, ...ZONES];

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await api.patch<BusinessSettings>("/settings", edits);
      setData(saved);
      setEdits({});
      // Times across the dashboard follow the business zone from here on.
      if (setBusinessZone(saved.timezone)) window.location.reload();
      setMessage({ ok: true, text: "Saved." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  }

  const row = (label: string, help: string, control: React.ReactNode) => (
    <div className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:items-center sm:gap-8">
      <div>
        <p className="text-[15px]">{label}</p>
        <p className="mt-0.5 text-[12px] leading-snug text-muted">{help}</p>
      </div>
      <div className="flex sm:justify-end">{control}</div>
    </div>
  );

  return (
    <section className="pt-3">
      <h2 className="section-title px-1">Business</h2>
      <p className="footnote mb-3 mt-1 max-w-2xl px-1">
        How the business appears, the time zone calls are shown in, and who the receptionist puts callers
        through to.
      </p>
      <div className="group-list px-5">
        {row(
          "Business name",
          "Shown in the sidebar and spoken in the receptionist's greeting.",
          <input
            className="input w-full sm:max-w-[300px]"
            aria-label="Business name"
            value={value.name}
            onChange={(e) => set("name", e.target.value)}
            disabled={!canEdit}
          />,
        )}
        {row(
          "Time zone",
          "Call times across the dashboard are shown in this zone.",
          <select
            className="select w-full sm:max-w-[300px]"
            aria-label="Time zone"
            value={value.timezone}
            onChange={(e) => set("timezone", e.target.value)}
            disabled={!canEdit}
          >
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>,
        )}
        {row(
          "Transfer number",
          "When a caller asks for a person, the receptionist tells the person who is calling and why, then connects them. Leave empty to take a message instead.",
          <input
            className="input w-full sm:max-w-[300px]"
            aria-label="Transfer number"
            type="tel"
            placeholder="+1 555 123 4567"
            value={value.escalation_phone ?? ""}
            onChange={(e) => set("escalation_phone", e.target.value)}
            disabled={!canEdit}
          />,
        )}
      </div>
      {(dirty || message) && (
        <div className="mt-3 flex items-center justify-end gap-3 px-1">
          {message && <p className={`text-[13px] ${message.ok ? "text-good" : "text-bad"}`}>{message.text}</p>}
          {dirty && (
            <>
              <button className="btn-secondary" onClick={() => setEdits({})} disabled={busy}>
                Discard
              </button>
              <button className="btn-primary" onClick={save} disabled={busy || !value.name.trim()}>
                {busy && <Spinner className="h-3.5 w-3.5" />}
                Save
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function AppearancePanel() {
  const [theme, choose] = useState<Theme>("system");
  // Read after mount: the server render can't know this browser's choice.
  useEffect(() => choose(getTheme()), []);
  return (
    <section className="pt-3">
      <h2 className="section-title px-1">Appearance</h2>
      <p className="footnote mb-3 mt-1 px-1">Applies to this browser only.</p>
      <div className="card flex items-center justify-between gap-4 px-5 py-4">
        <span className="text-[15px]">Theme</span>
        <Segmented<Theme>
          options={[
            { value: "system", label: "Automatic" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          value={theme}
          onChange={(t) => {
            choose(t);
            setTheme(t);
          }}
        />
      </div>
    </section>
  );
}

function DigestTest({ disabled }: { disabled: boolean }) {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-hairline bg-surface px-5 py-4">
      <input
        className="input max-w-[260px]"
        type="email"
        placeholder="Send to (defaults to recipients)"
        aria-label="Send a test digest to"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        disabled={disabled}
      />
      <button
        className="btn-secondary"
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          try {
            await api.post("/settings/digest/test", { to: to.trim() });
            setMessage({ ok: true, text: "Sent. Check the inbox." });
          } catch (err) {
            setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not send" });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Spinner className="h-3.5 w-3.5" />}
        Send a test
      </button>
      {disabled && <span className="text-[13px] text-muted">Save your changes first.</span>}
      {message && <p className={`w-full text-[13px] ${message.ok ? "text-good" : "text-bad"}`}>{message.text}</p>}
    </div>
  );
}
