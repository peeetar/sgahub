"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { unlockVault } from "./actions";

export default function VaultGate() {
  const router = useRouter();
  const [step, setStep] = useState<"sure" | "password">("sure");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();

  return (
    <section className="panel vault__gate">
      <div className="vault__lock" aria-hidden="true">🔒</div>
      {step === "sure" ? (
        <>
          <h2>Are you sure you want to open the vault?</h2>
          <p className="muted">It holds every password, key and login the SGA has, for every project. Opening it is written to the log with your name on it, and it closes by itself after 10 minutes.</p>
          <div className="row">
            <button className="btn btn--primary" autoFocus onClick={() => setStep("password")}>Yes, open it</button>
            <button className="btn btn--out" onClick={() => router.push("/settings")}>No, go back</button>
          </div>
        </>
      ) : (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          start(async () => {
            const r = await unlockVault(pw);
            if (r) { setErr(r); setPw(""); } else router.refresh();
          });
        }}>
          <h2>Vault password</h2>
          <label className="lbl">Master password
            <input className="field" type="password" autoComplete="off" autoFocus required value={pw} onChange={(e) => setPw(e.target.value)} />
          </label>
          {err && <p className="error" role="alert">{err}</p>}
          <div className="row">
            <button className="btn btn--primary" disabled={busy || !pw}>{busy ? "Checking…" : "Open the vault"}</button>
            <button type="button" className="btn btn--out" onClick={() => { setStep("sure"); setPw(""); setErr(null); }}>Back</button>
          </div>
        </form>
      )}
    </section>
  );
}
