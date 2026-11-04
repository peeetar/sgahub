"use client";

import { useState, useTransition } from "react";
import { changeMyPassword } from "../people/actions";

export default function AccountForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <form className="stack" style={{ maxWidth: 360 }} onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const err = await changeMyPassword(current, next);
        setMsg(err ? { ok: false, text: err } : { ok: true, text: "Password changed." });
        if (!err) { setCurrent(""); setNext(""); }
      });
    }}>
      <label className="lbl">Current password<input className="field field--sm" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
      <label className="lbl">New password (10+ characters)<input className="field field--sm" type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required /></label>
      {msg && <p className={msg.ok ? "muted" : "error"}>{msg.text}</p>}
      <button className="btn btn--sm btn--primary" disabled={busy || !current || next.length < 10}>{busy ? "Saving…" : "Change password"}</button>
    </form>
  );
}
