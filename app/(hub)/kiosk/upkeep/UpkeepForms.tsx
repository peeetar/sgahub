"use client";

import { useState } from "react";
import { addUpkeep, deleteUpkeep, saveBanner, upkeepDone } from "../live-actions";
import { useAct } from "../useAct";

export function TaskActions({ id, name }: { id: number; name: string }) {
  const { busy, run, note } = useAct();
  return (
    <div className="row row--tight row--end">
      {note}
      <button className="btn btn--sm" disabled={busy} onClick={() => run(() => upkeepDone(id))}>Done</button>
      <button className="linkbtn" disabled={busy} onClick={() => { if (confirm(`Remove “${name}”?`)) run(() => deleteUpkeep(id)); }}>Remove</button>
    </div>
  );
}

const digits = (raw: string) => raw.replace(/\D/g, "").slice(0, 6);

export function AddTask() {
  const [name, setName] = useState("");
  const [coffees, setCoffees] = useState("");
  const [days, setDays] = useState("");
  const { busy, run, note } = useAct();
  const ready = name.trim() !== "" && (coffees !== "" || days !== "");
  return (
    <form className="row row--tight" onSubmit={(e) => {
      e.preventDefault();
      run(() => addUpkeep(name, coffees, days), (o) => { if (o.ok) { setName(""); setCoffees(""); setDays(""); } });
    }}>
      <input className="field field--sm grow" placeholder="Descale the Inissia" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-label="Job" />
      <input className="field field--sm field--tiny" inputMode="numeric" placeholder="Coffees" value={coffees} onChange={(e) => setCoffees(digits(e.target.value))} aria-label="Every so many coffees" />
      <input className="field field--sm field--tiny" inputMode="numeric" placeholder="Days" value={days} onChange={(e) => setDays(digits(e.target.value))} aria-label="Every so many days" />
      <button className="btn btn--sm btn--primary" disabled={busy || !ready}>Add</button>
      {note}
    </form>
  );
}

export function BannerForm({ text, from, to }: { text: string; from: string; to: string }) {
  const [value, setValue] = useState(text);
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const { busy, run, note } = useAct();
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); run(() => saveBanner(value, start, end)); }}>
      <input className="field field--sm" maxLength={140} placeholder="New: Maple Pecan is back" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Banner text" />
      <div className="row row--tight">
        <label className="small">From <input className="field field--sm" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="small">Until <input className="field field--sm" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      <div className="row row--tight">
        <button className="btn btn--sm btn--primary" disabled={busy}>Save banner</button>
        {text !== "" && <button type="button" className="linkbtn" disabled={busy} onClick={() => run(() => saveBanner("", "", ""), (o) => { if (o.ok) { setValue(""); setStart(""); setEnd(""); } })}>Clear</button>}
        {note}
      </div>
    </form>
  );
}
