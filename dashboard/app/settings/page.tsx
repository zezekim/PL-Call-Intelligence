"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { AlertIcon, CheckIcon } from "@/components/icons";
import { Card, CardHeader, ErrorNote, Loading, Modal, Spinner } from "@/components/ui";

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
    title: "Spending",
    description: "Paid services pause for the rest of the day once the cap is reached.",
    keys: ["daily_spend_cap_usd"],
  },
];

const MODE_CHOICES = [
  { value: "standard", label: "Standard - one model, three runs, majority vote" },
  { value: "enhanced", label: "Enhanced - two models deliberate (about 2x the cost)" },
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-bold leading-none tracking-tight">Settings</h1>
          <p className="mt-2 text-sm text-muted">
            Keys are stored encrypted and can only be replaced, never viewed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="inline-flex items-center gap-1 text-sm text-good">
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

      {SECTIONS.map((section) => (
        <Card key={section.title} className="p-6">
          <CardHeader title={section.title} />
          <p className="-mt-2 mb-4 text-sm text-muted">{section.description}</p>
          <div className="divide-y divide-line">
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
          {section.title === "Spending" && spend.data && (
            <SpendMeter spent={spend.data.spent_today_usd} cap={spend.data.cap_usd} />
          )}
        </Card>
      ))}

      <Modal open={confirming} onClose={() => !saving && setConfirming(false)} title="Save these changes?">
        <div className="flex gap-3 rounded-2xl bg-warn-soft p-4 text-sm">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <p>
            Changing these settings can break the demo. A wrong or missing key stops calls from
            being transcribed, scored or answered until it is fixed.
          </p>
        </div>
        <ul className="mt-4 space-y-1 text-sm">
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
          <span className={`chip ${field.is_set ? "bg-good-soft text-good" : "bg-panel text-muted"}`}>
            {field.is_set ? "Set" : "Not set"}
          </span>
          {edit === "" && <span className="chip bg-warn-soft text-warn">Will reset</span>}
          <button className="btn-secondary px-3 py-1.5" onClick={() => setReplacing(true)} disabled={disabled}>
            {field.is_set ? "Replace" : "Add"}
          </button>
          {field.overridden && edit !== "" && (
            <button className="btn-ghost px-3 py-1.5" onClick={() => onEdit("")} disabled={disabled}>
              Reset to server default
            </button>
          )}
        </div>
      );
  } else if (field.kind === "bool") {
    const current = (edit ?? field.value) === "true";
    control = (
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[#1f6feb]"
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
        className="select max-w-md"
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
        className="select max-w-sm"
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
        className="input max-w-sm"
        inputMode={field.kind === "float" || field.kind === "int" ? "decimal" : undefined}
        value={edit ?? field.value}
        onChange={(e) => onEdit(e.target.value === field.value ? null : e.target.value)}
        disabled={disabled}
      />
    );
  }

  return (
    <div className="grid gap-2 py-4 sm:grid-cols-[240px_1fr] sm:gap-6">
      <div>
        <p className="text-sm font-medium">{field.label}</p>
        {field.help && <p className="mt-0.5 text-xs text-muted">{field.help}</p>}
      </div>
      <div className="self-center">{control}</div>
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
    <div className="max-w-md space-y-1.5">
      <select
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
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-panel px-4 py-3">
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">Connect the number</p>
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
  const tone = pctUsed >= 100 ? "bg-bad" : pctUsed >= 75 ? "bg-warn" : "bg-accent";
  return (
    <div className="mt-4 rounded-2xl bg-panel px-4 py-3">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">Spent today</span>
        <span className="tnum">
          ${spent.toFixed(2)} {cap > 0 ? `of $${cap.toFixed(2)}` : "(no cap)"}
        </span>
      </div>
      {cap > 0 && (
        <div className="mt-2 h-2 rounded-full bg-white" title={`${pctUsed.toFixed(0)}% of today's cap`}>
          <div className={`h-2 rounded-full ${tone}`} style={{ width: `${pctUsed}%` }} />
        </div>
      )}
      {pctUsed >= 100 && (
        <p className="mt-2 text-xs text-bad">Cap reached: paid services are paused until tomorrow (UTC).</p>
      )}
    </div>
  );
}
