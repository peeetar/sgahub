"use client";

import { useState } from "react";
import { PasswordForm } from "@/components/ui";

const MESSAGES: Record<string, string> = {
  invalid: "Enter your username and password.",
  wrong: "Wrong username or password.",
  rate_limited: "Too many tries. Wait a few minutes.",
  misconfigured: "The server is missing HUB_SECRET (it needs 32+ random characters). Set it in Vercel and redeploy.",
  not_configured: "HUB_PASSWORD isn't set on the server.",
  too_short: "HUB_PASSWORD in Vercel is shorter than 8 characters, so it is switched off.",
  wrong_password: "Wrong password.",
  server: "Something went wrong on the server. Try again in a minute.",
};

export default function LoginForm({ passwordEnabled }: { passwordEnabled: boolean }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  if (shared) {
    return (
      <div className="stack">
        <p className="muted">The emergency board password. Use your own username when you can: it keeps a record of who did what.</p>
        <PasswordForm submitLabel="Sign in" onSubmit={async (pw) => {
          const res = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) }).catch(() => null);
          if (res?.ok) { location.href = "/"; return null; }
          if (!res) return "No connection.";
          const body = await res.json().catch(() => null);
          return MESSAGES[body?.code] || `Sign-in failed (${res.status}).`;
        }} />
        <button className="linkbtn" onClick={() => setShared(false)}>Use my username instead</button>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }).catch(() => null);
      if (res?.ok) { location.href = "/"; return; }
      const body = await res?.json().catch(() => null);
      setError(res ? MESSAGES[body?.code] || MESSAGES.server : "No connection.");
      setPassword("");
      setBusy(false);
    }}>
      <p className="muted">Board members sign in with the username and password a board member set for them on the People page.</p>
      <input required autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Username" className="field"
        value={username} onChange={(e) => setUsername(e.target.value)} />
      <input type="password" required autoComplete="current-password" placeholder="Password" className="field"
        value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p className="error">{error}</p>}
      <button className="btn btn--primary" disabled={busy || !username || !password}>{busy ? "Checking…" : "Sign in"}</button>
      {passwordEnabled && <button type="button" className="linkbtn" onClick={() => setShared(true)}>Use the emergency shared password</button>}
    </form>
  );
}
