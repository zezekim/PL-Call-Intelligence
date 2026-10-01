"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, setToken } from "@/lib/api";
import { useTitle } from "@/lib/hooks";
import { askForEnvironmentNext } from "@/components/environment";
import { ErrorNote, Spinner } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useTitle("Sign in");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<{ access_token: string }>("/auth/login", { email, password });
      setToken(result.access_token);
      askForEnvironmentNext();
      router.replace("/v2");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-[13px] bg-ink text-[20px] font-semibold text-canvas">
            P
          </span>
          <h1 className="mt-5 text-[28px] font-semibold tracking-title">Sign in to PestLaunch</h1>
          <p className="mt-1 text-[15px] text-muted">Call intelligence</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6" noValidate>
          {error && <ErrorNote message={error} />}
          <label className="block">
            <span className="mb-1.5 block text-[13px] text-muted">Email</span>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              spellCheck={false}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] text-muted">Password</span>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button type="submit" className="btn-primary w-full py-2.5 text-[15px]" disabled={busy}>
            {busy && <Spinner className="h-3.5 w-3.5" />}
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
