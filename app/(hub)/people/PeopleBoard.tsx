"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Dialog } from "@/components/ui";
import { importPeople, removePerson, saveDuties, savePerson, type PersonInput } from "./actions";

export type Role = { id: string; title: string; duties: string; seats: number };
export type Person = { id: string; name: string; role_id: string | null; email: string | null; notion_user_id: string | null; notes: string; term: string; username: string | null };

export default function PeopleBoard({ roles, people, term, current, terms }: {
  roles: Role[]; people: Person[]; term: string; current: string; terms: string[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ person: Person | null; role_id: string | null } | null>(null);
  const [importing, setImporting] = useState(false);
  const [duties, setDuties] = useState<Role | null>(null);
  const past = term !== current;
  const unassigned = people.filter((p) => !p.role_id || !roles.some((r) => r.id === p.role_id));

  return (
    <main className="hubpage">
      <header className="hubpage__head">
        <h1>People</h1>
        <div className="row">
          <select className="field field--sm field--short" value={term} onChange={(e) => router.push(`/people?term=${e.target.value}`)} aria-label="Term">
            {terms.map((t) => <option key={t} value={t}>{t}{t === current ? " (current)" : ""}</option>)}
          </select>
          <button className="btn btn--sm" onClick={() => setImporting(true)}>Paste a list</button>
          <button className="btn btn--sm btn--primary" onClick={() => setEditing({ person: null, role_id: null })}>+ Add person</button>
        </div>
      </header>
      {past
        ? <div className="notice">You&apos;re looking at the {term} board. They can&apos;t sign in; only the current term ({current}) can.</div>
        : <p className="muted small">Everyone here with a username and password can sign in to the hub. Set or reset them by opening the person. The Notion user ID tags them as an attendee on meeting notes.</p>}

      <div className="roles">
        {roles.map((r) => {
          const holders = people.filter((p) => p.role_id === r.id);
          const open = Math.max(0, r.seats - holders.length);
          return (
            <section key={r.id} className="role">
              <header className="role__head">
                <h2>{r.title}</h2>
                <button className="linkbtn" onClick={() => setDuties(r)}>Duties</button>
              </header>
              <p className="role__duties muted small">{r.duties}</p>
              <ul className="role__people">
                {holders.map((p) => <PersonRow key={p.id} p={p} onEdit={() => setEditing({ person: p, role_id: p.role_id })} />)}
                {Array.from({ length: open }, (_, i) => (
                  <li key={"open" + i}><button className="vacant" onClick={() => setEditing({ person: null, role_id: r.id })}>Vacant · add</button></li>
                ))}
              </ul>
            </section>
          );
        })}
        {unassigned.length > 0 && (
          <section className="role">
            <header className="role__head"><h2>Other</h2></header>
            <ul className="role__people">{unassigned.map((p) => <PersonRow key={p.id} p={p} onEdit={() => setEditing({ person: p, role_id: null })} />)}</ul>
          </section>
        )}
      </div>

      {editing && <PersonDialog roles={roles} term={term} {...editing} onClose={() => setEditing(null)} />}
      {importing && <ImportDialog term={term} onClose={() => setImporting(false)} />}
      {duties && <DutiesDialog role={duties} onClose={() => setDuties(null)} />}
    </main>
  );
}

/** 16 characters, no look-alikes (0/O, 1/l/I), easy to read out or type on a phone. */
function makePassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function PersonRow({ p, onEdit }: { p: Person; onEdit: () => void }) {
  return (
    <li>
      <button className="person" onClick={onEdit}>
        <span className="person__avatar" aria-hidden="true">{p.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
        <span className="person__text">
          <strong>{p.name}</strong>
          <span className="muted small">{p.username ? `@${p.username}` : "no login yet"}{p.notion_user_id ? " · Notion ✓" : ""}</span>
        </span>
      </button>
    </li>
  );
}

function PersonDialog({ roles, term, person, role_id, onClose }: {
  roles: Role[]; term: string; person: Person | null; role_id: string | null; onClose: () => void;
}) {
  const [f, setF] = useState<PersonInput>({
    name: person?.name || "", role_id: person?.role_id ?? role_id, email: person?.email || "",
    notion_user_id: person?.notion_user_id || "", notes: person?.notes || "", term: person?.term || term,
    username: person?.username || "", password: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: keyof PersonInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog title={person ? `Edit ${person.name}` : "Add a person"} onClose={onClose}>
      <form className="stack" onSubmit={(e) => {
        e.preventDefault();
        start(async () => { const r = await savePerson(person?.id ?? null, f); if (r) setErr(r); else onClose(); });
      }}>
        <label className="lbl">Name<input className="field field--sm" required value={f.name} maxLength={80} onChange={set("name")} /></label>
        <label className="lbl">Role
          <select className="field field--sm" value={f.role_id || ""} onChange={set("role_id")}>
            <option value="">No role</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
        </label>
        <label className="lbl">Email (optional, never emailed)<input className="field field--sm" type="email" value={f.email} onChange={set("email")} placeholder="name@act.edu" /></label>
        <label className="lbl">Username (to sign in)<input className="field field--sm" value={f.username} autoCapitalize="none" spellCheck={false} maxLength={32} onChange={set("username")} placeholder="petar" /></label>
        <label className="lbl">{person?.username ? "New password (leave empty to keep theirs)" : "Password"}
          <span className="row">
            <input className="field field--sm grow mono" value={f.password} autoComplete="off" spellCheck={false} onChange={set("password")} placeholder="at least 10 characters" />
            <button type="button" className="btn btn--sm" onClick={() => setF({ ...f, password: makePassword() })}>Generate</button>
          </span>
        </label>
        {f.password && <p className="muted small">Copy it now and send it to them. It is stored scrambled and can&apos;t be shown again. They can change it under Account.</p>}
        <label className="lbl">Notion user ID (optional)<input className="field field--sm" value={f.notion_user_id} onChange={set("notion_user_id")} placeholder="1a2b3c4d-0000-4000-8000-00000000abcd" /></label>
        <label className="lbl">Notes<textarea className="field field--sm" rows={2} value={f.notes} onChange={set("notes")} placeholder="e.g. merch lead, liaison with IPO" /></label>
        {err && <p className="error">{err}</p>}
        <div className="row">
          {person && <button type="button" className="btn btn--sm btn--out" disabled={busy} onClick={() => {
            if (confirm(`Remove ${person.name}? They will no longer be able to sign in.`)) start(async () => { await removePerson(person.id); onClose(); });
          }}>Remove</button>}
          <span className="grow" />
          <button type="button" className="btn btn--sm" onClick={onClose}>Cancel</button>
          <button className="btn btn--sm btn--primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Dialog>
  );
}

function ImportDialog({ term, onClose }: { term: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, start] = useTransition();
  return (
    <Dialog title={`Paste the ${term} board`} onClose={onClose} wide>
      <p className="muted small">One person per line: <code>Role | Name | email | Notion user ID</code>. Email and Notion ID are optional. Lines starting with # are skipped. If any line is wrong, nothing is added.</p>
      <textarea className="field field--sm mono" rows={12} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={"President | Jane Doe | jdoe@act.edu\nTreasurer | John Doe"} />
      {errors.length > 0 && <ul className="error small">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="row">
        <span className="grow" />
        <button className="btn btn--sm" onClick={onClose}>Cancel</button>
        <button className="btn btn--sm btn--primary" disabled={busy || !text.trim()} onClick={() => start(async () => {
          const r = await importPeople(text, term);
          if (r.errors.length) setErrors(r.errors); else onClose();
        })}>{busy ? "Adding…" : "Add everyone"}</button>
      </div>
    </Dialog>
  );
}

function DutiesDialog({ role, onClose }: { role: Role; onClose: () => void }) {
  const [text, setText] = useState(role.duties);
  const [busy, start] = useTransition();
  return (
    <Dialog title={`${role.title}: duties`} onClose={onClose}>
      <textarea className="field field--sm" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row">
        <span className="grow" />
        <button className="btn btn--sm" onClick={onClose}>Cancel</button>
        <button className="btn btn--sm btn--primary" disabled={busy} onClick={() => start(async () => { await saveDuties(role.id, text); onClose(); })}>Save</button>
      </div>
    </Dialog>
  );
}
