"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Dialog } from "@/components/ui";
import { KINDS, type EntryInput, type Kind, type LogRow, type VaultEntry } from "@/lib/vault-types";
import { addStarterEntries, deleteVaultEntry, lockVault, reencrypt, revealEntry, saveVaultEntry } from "./actions";

const SHOW_SECONDS = 30;

export default function VaultBoard({ entries, log, until, unreadable, canRotate }: {
  entries: VaultEntry[]; log: LogRow[]; until: number; unreadable: number; canRotate: boolean;
}) {
  const router = useRouter();
  const [left, setLeft] = useState(() => Math.max(0, Math.round((until - Date.now()) / 1000)));
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<VaultEntry | "new" | null>(null);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // The countdown. At zero the page reloads into the locked state.
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.max(0, Math.round((until - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) { clearInterval(t); setShown({}); router.refresh(); }
    }, 1000);
    return () => clearInterval(t);
  }, [until, router]);
  useEffect(() => () => { Object.values(timers.current).forEach(clearTimeout); }, []);

  const hide = (id: string) => setShown((s) => { const n = { ...s }; delete n[id]; return n; });

  const reveal = (e: VaultEntry, purpose: "show" | "copy") => start(async () => {
    setMsg(null);
    const r = await revealEntry(e.id, purpose);
    if ("error" in r) { setMsg(r.error); return; }
    if (purpose === "copy") {
      try { await navigator.clipboard.writeText(r.value); setMsg(`Copied “${e.label}”. It stays on your clipboard until you copy something else.`); }
      catch { setMsg("The browser wouldn't copy. Use Show instead."); }
      return;
    }
    setShown((s) => ({ ...s, [e.id]: r.value }));
    clearTimeout(timers.current[e.id]);
    timers.current[e.id] = setTimeout(() => hide(e.id), SHOW_SECONDS * 1000);
  });

  const visible = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? entries.filter((e) => [e.label, e.category, e.username, e.notes, e.url].some((x) => x.toLowerCase().includes(n))) : entries;
  }, [entries, q]);

  // Categories keep the order of their first entry.
  const groups = useMemo(() => {
    const m = new Map<string, VaultEntry[]>();
    for (const e of visible) m.set(e.category, [...(m.get(e.category) ?? []), e]);
    return [...m.entries()];
  }, [visible]);
  const categories = useMemo(() => [...new Set(entries.map((e) => e.category))], [entries]);
  const filled = entries.filter((e) => e.filled).length;

  return (
    <>
      <div className="vault__bar">
        <span suppressHydrationWarning><strong>Open</strong> · closes in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>
        <span className="grow" />
        <span className="muted small">{filled} of {entries.length} filled in</span>
        <button className="btn btn--sm btn--out" disabled={busy} onClick={() => start(async () => { await lockVault(); setShown({}); router.refresh(); })}>Lock now</button>
      </div>

      {unreadable > 0 && (
        <div className="notice notice--bad">
          <strong>{unreadable} saved {unreadable === 1 ? "secret can't" : "secrets can't"} be read with the current vault password.</strong>{" "}
          {canRotate
            ? <>The previous password is set. <button className="linkbtn" disabled={busy} onClick={() => start(async () => setMsg(await reencrypt()))}>Re-encrypt them now</button>.</>
            : <>If you changed <code>VAULT_PASSWORD</code>, put the old one in <code>VAULT_PASSWORD_PREVIOUS</code>, redeploy, then come back here. Otherwise type those values in again.</>}
        </div>
      )}
      {msg && <p className="notice" role="status">{msg}</p>}

      <div className="row vault__tools">
        <input className="field field--sm grow" type="search" placeholder="Search the vault" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn--sm btn--primary" onClick={() => setEditing("new")}>Add</button>
        <button className="btn btn--sm btn--out" disabled={busy} onClick={() => start(async () => setMsg(await addStarterEntries()))}>Add missing starter entries</button>
      </div>

      {groups.length === 0 && <p className="muted">Nothing matches.</p>}
      {groups.map(([cat, list]) => {
        const done = list.filter((e) => e.filled).length;
        return (
          <section key={cat} className="panel vault__cat">
            <h2 className="vault__cathead">{cat}<span className="muted small"> · {done} of {list.length} filled in</span></h2>
            <ul className="vault__list">
              {list.map((e) => (
                <li key={e.id} className="vault__item">
                  <div className="vault__main">
                    <div className="vault__title">
                      <strong>{e.label}</strong>
                      <span className="pill pill--soft">{KINDS[e.kind]}</span>
                      {!e.filled && e.kind !== "link" && <span className="pill pill--warn">Not filled in</span>}
                    </div>
                    {(e.username || e.url) && (
                      <p className="small vault__meta">
                        {e.username && <><span className="muted">User</span> <code>{e.username}</code> </>}
                        {e.url && /^https?:\/\//i.test(e.url) ? <a href={e.url} target="_blank" rel="noreferrer">{e.url.replace(/^https?:\/\//, "")}</a> : e.url}
                      </p>
                    )}
                    {e.notes && <p className="muted small vault__notes">{e.notes}</p>}
                    {shown[e.id] !== undefined && (
                      <pre className="vault__value mono" onClick={(ev) => { const s = window.getSelection(); if (s) { s.selectAllChildren(ev.currentTarget); } }}>{shown[e.id]}</pre>
                    )}
                  </div>
                  <div className="vault__acts">
                    {e.filled && (shown[e.id] !== undefined
                      ? <button className="btn btn--sm btn--out" onClick={() => hide(e.id)}>Hide</button>
                      : <button className="btn btn--sm btn--out" disabled={busy} onClick={() => reveal(e, "show")}>Show</button>)}
                    {e.filled && <button className="btn btn--sm btn--out" disabled={busy} onClick={() => reveal(e, "copy")}>Copy</button>}
                    <button className="btn btn--sm" onClick={() => setEditing(e)}>{e.filled ? "Edit" : "Fill in"}</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className="panel">
        <h2>Who has been in</h2>
        <p className="muted small">Opens, views, copies and changes. Values are never written to the log.</p>
        {log.length === 0 ? <p className="muted small">Nothing yet.</p> : (
          <table className="tbl">
            <tbody>
              {log.map((l, i) => (
                <tr key={i}><td className="small muted">{l.at.slice(0, 16).replace("T", " ")}</td><td>{l.who}</td><td>{l.action}{l.detail ? <span className="muted"> · {l.detail}</span> : null}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editing && (
        <EntryDialog entry={editing === "new" ? null : editing} categories={categories}
          onClose={() => setEditing(null)} onDone={() => { setEditing(null); hide(editing === "new" ? "" : editing.id); router.refresh(); }} />
      )}
    </>
  );
}

function EntryDialog({ entry, categories, onClose, onDone }: {
  entry: VaultEntry | null; categories: string[]; onClose: () => void; onDone: () => void;
}) {
  const [f, setF] = useState({
    category: entry?.category ?? categories[0] ?? "", label: entry?.label ?? "", kind: (entry?.kind ?? "password") as Kind,
    username: entry?.username ?? "", url: entry?.url ?? "", notes: entry?.notes ?? "", secret: "", clear: false,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const long = f.kind === "note";

  return (
    <Dialog title={entry ? entry.label : "Add to the vault"} onClose={onClose}>
      <form className="stack" autoComplete="off" onSubmit={(e) => {
        e.preventDefault();
        const input: EntryInput = { category: f.category, label: f.label, kind: f.kind, username: f.username, url: f.url, notes: f.notes };
        if (f.clear) input.clear = true; else if (f.secret) input.secret = f.secret;
        start(async () => { const r = await saveVaultEntry(entry?.id ?? null, input); if (r) setErr(r); else onDone(); });
      }}>
        <div className="row">
          <label className="lbl grow">Category
            <input className="field field--sm" required list="vault-cats" maxLength={40} value={f.category} onChange={set("category")} />
            <datalist id="vault-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="lbl">Type
            <select className="field field--sm" value={f.kind} onChange={set("kind")}>
              {(Object.keys(KINDS) as Kind[]).map((k) => <option key={k} value={k}>{KINDS[k]}</option>)}
            </select>
          </label>
        </div>
        <label className="lbl">Name<input className="field field--sm" required maxLength={80} value={f.label} onChange={set("label")} placeholder="What is it?" /></label>
        <div className="row">
          <label className="lbl grow">Username<input className="field field--sm" maxLength={120} value={f.username} onChange={set("username")} autoComplete="off" /></label>
          <label className="lbl grow">Link<input className="field field--sm" maxLength={300} value={f.url} onChange={set("url")} placeholder="https://" autoComplete="off" /></label>
        </div>
        <label className="lbl">{entry?.filled ? "New value (leave empty to keep the saved one)" : "Value"}
          {long
            ? <textarea className="field field--sm mono" rows={5} maxLength={20000} value={f.secret} onChange={set("secret")} disabled={f.clear} autoComplete="off" spellCheck={false} />
            : <input className="field field--sm mono" type="password" maxLength={20000} value={f.secret} onChange={set("secret")} disabled={f.clear} autoComplete="new-password" spellCheck={false} />}
        </label>
        {entry?.filled && (
          <label className="check"><input type="checkbox" checked={f.clear} onChange={(e) => setF({ ...f, clear: e.target.checked, secret: "" })} /> Remove the saved value</label>
        )}
        <label className="lbl">Notes<textarea className="field field--sm" rows={3} maxLength={1000} value={f.notes} onChange={set("notes")} placeholder="Where it's used, who has it, how to reset it. Not the secret itself." /></label>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="row">
          {entry && <button type="button" className="btn btn--sm btn--out" disabled={busy} onClick={() => {
            if (confirm(`Delete "${entry.label}" from the vault? The saved value is lost.`)) start(async () => { await deleteVaultEntry(entry.id); onDone(); });
          }}>Delete</button>}
          <span className="grow" />
          <button type="button" className="btn btn--sm" onClick={onClose}>Cancel</button>
          <button className="btn btn--sm btn--primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Dialog>
  );
}
