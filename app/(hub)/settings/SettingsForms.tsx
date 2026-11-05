"use client";

import { useState, useTransition } from "react";
import { addSchedule, previewSchedule, sendTestAlert, startTerm, type SchedulePreview } from "./actions";

export function TestAlert() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="row">
      <button className="btn btn--sm" disabled={busy} onClick={() => start(async () => setMsg(await sendTestAlert()))}>
        {busy ? "Sending…" : "Send a test alert"}
      </button>
      {msg && <span className="muted small">{msg}</span>}
    </div>
  );
}

const next = (t: string) => {
  const y = Number(t.slice(0, 4)) + 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
};

export function TermForm({ current }: { current: string }) {
  const [term, setTerm] = useState(next(current));
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form className="row" onSubmit={(e) => {
      e.preventDefault();
      if (!confirm(`Switch to ${term}? People listed under ${current} will no longer be able to sign in.`)) return;
      start(async () => setErr(await startTerm(term)));
    }}>
      <input className="field field--sm field--short" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="New term" />
      <button className="btn btn--sm" disabled={busy || term === current}>Switch term</button>
      {err && <span className="error">{err}</span>}
    </form>
  );
}

const SCHEDULE_EXAMPLE = `# date | time (optional) | title | place | type | notes
2026-11-09 | 14:00-15:00 | Coffee Space opening | Library | coffee
2026-11-16..2026-11-20 | International Education Week | | school
18/11/2026 | Activities Fair & rep elections | Campus | event`;

/** Paste a list of events, check it, add it. */
export function ScheduleImport() {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const clear = () => { setPreview(null); setDone(null); };
  return (
    <div className="stack">
      <textarea className="field mono" rows={8} value={text} spellCheck={false} placeholder={SCHEDULE_EXAMPLE}
        onChange={(e) => { setText(e.target.value); clear(); }} aria-label="Schedule, one event per line" />
      <div className="row">
        <button className="btn btn--sm" disabled={busy || !text.trim()} onClick={() => start(async () => { setDone(null); setPreview(await previewSchedule(text)); })}>Check it</button>
        {preview && preview.errors.length === 0 && preview.events.length > 0 && (
          <button className="btn btn--sm btn--primary" disabled={busy} onClick={() => start(async () => {
            const r = await addSchedule(text);
            if (r.errors.length) setPreview({ errors: r.errors, events: [] });
            else { setDone(`Added ${r.added} event${r.added === 1 ? "" : "s"}${r.existing ? `; ${r.existing} were already on the calendar` : ""}.`); setPreview(null); setText(""); }
          })}>Add {preview.events.length} to the calendar</button>
        )}
        {done && <span className="pos">{done}</span>}
      </div>
      {preview?.errors.length ? <ul className="error">{preview.errors.slice(0, 12).map((e) => <li key={e}>{e}</li>)}{preview.errors.length > 12 && <li>…and {preview.errors.length - 12} more</li>}</ul> : null}
      {preview && preview.errors.length === 0 && (
        <table className="tbl">
          <thead><tr><th>Date</th><th>Time</th><th>Event</th><th>Type</th></tr></thead>
          <tbody>{preview.events.map((e, i) => (
            <tr key={i}><td>{e.day}{e.until ? ` → ${e.until}` : ""}</td><td>{e.time}</td><td>{e.title}{e.place ? <span className="muted small"> · {e.place}</span> : null}</td><td>{e.type}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
