"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Dialog } from "@/components/ui";
import { addDays, addMonths, diffDays, fmtDay, monthGrid, relative, startOfWeek } from "@/lib/days";
import { CATEGORIES, type EventInput, type EventRow } from "@/lib/event-types";
import { removeEvent, saveEvent, shiftEvent } from "./actions";

type View = "month" | "week" | "list";
const MAX_CHIPS = 3;

const lastDay = (e: EventRow) => e.ends_on ?? e.starts_on;
const onDay = (e: EventRow, day: string) => e.starts_on <= day && day <= lastDay(e);
const timeLabel = (e: EventRow) => (e.start_time ? e.start_time + (e.end_time ? `–${e.end_time}` : "") : "");
const sortDay = (a: EventRow, b: EventRow) => (a.start_time ?? "").localeCompare(b.start_time ?? "") || a.title.localeCompare(b.title);

function shifted(e: EventRow, day: string): EventRow {
  return { ...e, starts_on: day, ends_on: e.ends_on ? addDays(day, diffDays(e.ends_on, e.starts_on)) : null };
}

export default function CalendarBoard({ events: fromServer, today }: { events: EventRow[]; today: string }) {
  const router = useRouter();
  const [events, setEvents] = useState(fromServer);
  useEffect(() => setEvents(fromServer), [fromServer]);
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(today);
  const [editing, setEditing] = useState<{ event: EventRow | null; day: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [, start] = useTransition();
  const [over, setOver] = useState<string | null>(null);

  const step = (dir: 1 | -1) => setCursor(view === "month" ? addMonths(cursor, dir) : addDays(cursor, dir * (view === "week" ? 7 : 30)));
  const title = view === "month" ? fmtDay(cursor, { month: "long", year: "numeric" })
    : view === "week" ? `${fmtDay(startOfWeek(cursor), { day: "numeric", month: "short" })} – ${fmtDay(addDays(startOfWeek(cursor), 6), { day: "numeric", month: "short", year: "numeric" })}`
    : `From ${fmtDay(cursor, { day: "numeric", month: "short", year: "numeric" })}`;

  function move(id: string, day: string) {
    const prev = events;
    setEvents((es) => es.map((e) => (e.id === id ? shifted(e, day) : e)));
    setMsg(null);
    start(async () => {
      const err = await shiftEvent(id, day);
      if (err) { setEvents(prev); setMsg(err); } else router.refresh();
    });
  }

  // A chip can be dragged from any day a long event covers; it lands where it's
  // dropped, so the day you grabbed is the day it moves to.
  const drop = (day: string) => (ev: React.DragEvent) => {
    ev.preventDefault();
    setOver(null);
    const [id, from] = ev.dataTransfer.getData("text/plain").split("|");
    const e = events.find((x) => x.id === id);
    if (!e || !from) return;
    const target = addDays(e.starts_on, diffDays(day, from));
    if (target !== e.starts_on) move(id, target);
  };
  const dropProps = (day: string) => ({
    onDragOver: (ev: React.DragEvent) => { ev.preventDefault(); setOver(day); },
    onDragLeave: () => setOver((o) => (o === day ? null : o)),
    onDrop: drop(day),
  });

  const chip = (e: EventRow, day: string) => (
    <button key={e.id + day} type="button" className={`ev ev--${e.category}`} draggable
      onDragStart={(ev) => { ev.dataTransfer.setData("text/plain", `${e.id}|${day}`); ev.dataTransfer.effectAllowed = "move"; }}
      onClick={(ev) => { ev.stopPropagation(); setEditing({ event: e, day }); }}
      title={[e.title, timeLabel(e), e.location].filter(Boolean).join(" · ")}>
      {e.start_time && <b>{e.start_time}</b>}
      <span>{e.title}</span>
    </button>
  );

  const days = view === "month" ? monthGrid(cursor) : view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i)) : [];
  const dayCell = (day: string) => {
    const list = events.filter((e) => onDay(e, day)).sort(sortDay);
    const shown = view === "month" ? list.slice(0, MAX_CHIPS) : list;
    return (
      <div key={day} className={"cal__day" + (day === today ? " is-today" : "") + (view === "month" && day.slice(0, 7) !== cursor.slice(0, 7) ? " is-faded" : "") + (over === day ? " is-over" : "")}
        {...dropProps(day)} onClick={() => setEditing({ event: null, day })}>
        <span className="cal__num">{view === "week" ? fmtDay(day, { weekday: "short", day: "numeric" }) : Number(day.slice(8))}</span>
        {shown.map((e) => chip(e, day))}
        {list.length > shown.length && (
          <button type="button" className="cal__more" onClick={(ev) => { ev.stopPropagation(); setView("week"); setCursor(day); }}>+{list.length - shown.length} more</button>
        )}
      </div>
    );
  };

  const agenda = useMemo(() => {
    const from = cursor;
    const by = new Map<string, EventRow[]>();
    for (let d = from; d <= addDays(from, 90); d = addDays(d, 1)) {
      const list = events.filter((e) => onDay(e, d) && (e.starts_on === d || d === from)).sort(sortDay);
      if (list.length) by.set(d, list);
    }
    return [...by.entries()];
  }, [events, cursor, today, view]);

  // The Upcoming column: everything that hasn't finished yet, soonest first.
  const [moreUpcoming, setMoreUpcoming] = useState(false);
  const upcoming = events.filter((e) => lastDay(e) >= today).sort((a, b) => a.starts_on.localeCompare(b.starts_on) || sortDay(a, b));
  const upShown = upcoming.slice(0, moreUpcoming ? 40 : 10);

  return (
    <main className="hubpage">
      <header className="hubpage__head">
        <h1>Calendar</h1>
        <div className="row">
          <div className="seg seg--3 seg--cal" role="tablist" aria-label="View">
            {(["month", "week", "list"] as View[]).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? "is-on" : ""} onClick={() => setView(v)}>{v === "list" ? "List" : v === "week" ? "Week" : "Month"}</button>
            ))}
          </div>
          <button className="btn btn--sm btn--primary" onClick={() => setEditing({ event: null, day: today })}>+ Add event</button>
        </div>
      </header>

      <div className="cal">
        <section className="cal__main">
          <div className="cal__bar">
            <div className="row row--tight">
              <button className="btn btn--sm" onClick={() => step(-1)} aria-label="Previous">‹</button>
              <button className="btn btn--sm" onClick={() => step(1)} aria-label="Next">›</button>
              <button className="btn btn--sm" onClick={() => setCursor(today)}>Today</button>
            </div>
            <h2 className="cal__title">{title}</h2>
            <span className="muted small cal__hint">Drag an event to another day to move it.</span>
          </div>
          {msg && <p className="error">{msg}</p>}

          {view !== "list" ? (
            <div className={"cal__grid cal__grid--" + view}>
              {view === "month" && ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="cal__dow">{d}</div>)}
              {days.map(dayCell)}
            </div>
          ) : agenda.length === 0 ? (
            <div className="panel"><p className="muted">Nothing in the next 90 days from here. Add an event, or paste a schedule under Settings.</p></div>
          ) : (
            <div className="agenda">
              {agenda.map(([day, list]) => (
                <section key={day} className="agenda__day">
                  <h3 className={day === today ? "is-today" : ""}>{fmtDay(day, { weekday: "long", day: "numeric", month: "long" })} <small>{relative(day, today)}</small></h3>
                  <ul>
                    {list.map((e) => (
                      <li key={e.id}>
                        <button type="button" className={`agenda__row ev--${e.category}`} onClick={() => setEditing({ event: e, day })}>
                          <span className="agenda__time">{e.start_time ? timeLabel(e) : "All day"}</span>
                          <strong>{e.title}</strong>
                          <span className="muted small">{[e.location, e.ends_on && e.ends_on !== day ? `until ${fmtDay(e.ends_on, { weekday: "short", day: "numeric", month: "short" })}` : ""].filter(Boolean).join(" · ")}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <ul className="cal__legend" aria-label="Colours">
            {Object.entries(CATEGORIES).map(([k, label]) => <li key={k}><i className={`ev--${k}`} />{label}</li>)}
          </ul>
        </section>

        <aside className="cal__side" aria-label="Upcoming">
          <div className="panel">
            <header className="panel__head"><h2>Upcoming</h2><span className="muted small">{upcoming.length} coming</span></header>
            {upShown.length === 0 ? <p className="muted">Nothing coming up. Add an event, or paste a schedule under Settings.</p> : (
              <ul className="upcoming">
                {upShown.map((e) => {
                  const running = e.starts_on <= today;
                  return (
                    <li key={e.id}>
                      <button type="button" className={`upcoming__row ev--${e.category}`} onClick={() => { setEditing({ event: e, day: e.starts_on }); }}>
                        <span className="upcoming__when">
                          <b>{running ? "Now" : relative(e.starts_on, today)}</b>
                          <small>{fmtDay(e.starts_on, { weekday: "short", day: "numeric", month: "short" })}{e.ends_on ? ` – ${fmtDay(e.ends_on, { day: "numeric", month: "short" })}` : ""}{e.start_time ? ` · ${timeLabel(e)}` : ""}</small>
                        </span>
                        <strong>{e.title}</strong>
                        {e.location && <span className="muted small">{e.location}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {upcoming.length > 10 && <button className="linkbtn" onClick={() => setMoreUpcoming(!moreUpcoming)}>{moreUpcoming ? "Show fewer" : `Show ${Math.min(30, upcoming.length - 10)} more`}</button>}
          </div>
        </aside>
      </div>

      {editing && <EventDialog key={editing.event?.id ?? "new" + editing.day} event={editing.event} day={editing.day} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); router.refresh(); }} />}
    </main>
  );
}

function EventDialog({ event, day, onClose, onSaved }: { event: EventRow | null; day: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    title: event?.title ?? "", category: event?.category ?? "event", starts_on: event?.starts_on ?? day, ends_on: event?.ends_on ?? "",
    allDay: !event?.start_time, start_time: event?.start_time ?? "14:00", end_time: event?.end_time ?? "", location: event?.location ?? "", notes: event?.notes ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const input = (): EventInput => ({
    title: f.title, category: f.category, starts_on: f.starts_on, ends_on: f.ends_on || null,
    start_time: f.allDay ? null : f.start_time || null, end_time: f.allDay ? null : f.end_time || null, location: f.location, notes: f.notes,
  });
  return (
    <Dialog title={event ? "Edit event" : "Add an event"} onClose={onClose}>
      <form className="stack" onSubmit={(e) => {
        e.preventDefault();
        start(async () => { const r = await saveEvent(event?.id ?? null, input()); if (r) setErr(r); else onSaved(); });
      }}>
        <label className="lbl">Title<input className="field field--sm" required autoFocus maxLength={120} value={f.title} onChange={set("title")} placeholder="Coffee Space opening" /></label>
        <div className="row">
          <label className="lbl grow">Type
            <select className="field field--sm" value={f.category} onChange={set("category")}>
              {Object.entries(CATEGORIES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label className="lbl grow">Place (optional)<input className="field field--sm" maxLength={120} value={f.location} onChange={set("location")} placeholder="Library" /></label>
        </div>
        <div className="row">
          <label className="lbl grow">Starts<input className="field field--sm" type="date" required value={f.starts_on} onChange={set("starts_on")} /></label>
          <label className="lbl grow">Ends (if more than a day)<input className="field field--sm" type="date" min={f.starts_on} value={f.ends_on} onChange={set("ends_on")} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={f.allDay} onChange={(e) => setF({ ...f, allDay: e.target.checked })} /> All day</label>
        {!f.allDay && (
          <div className="row">
            <label className="lbl grow">From<input className="field field--sm" type="time" required value={f.start_time} onChange={set("start_time")} /></label>
            <label className="lbl grow">To (optional)<input className="field field--sm" type="time" value={f.end_time} onChange={set("end_time")} /></label>
          </div>
        )}
        <label className="lbl">Notes<textarea className="field field--sm" rows={2} maxLength={1000} value={f.notes} onChange={set("notes")} /></label>
        {event && event.source !== "manual" && <p className="muted small">{event.source === "import" ? "Added from a pasted schedule." : "Added from a meeting's notes."} You can still change or move it.</p>}
        {err && <p className="error">{err}</p>}
        <div className="row">
          {event && <button type="button" className="btn btn--sm btn--out" disabled={busy} onClick={() => {
            if (confirm(`Delete "${event.title}"?`)) start(async () => { await removeEvent(event.id); onSaved(); });
          }}>Delete</button>}
          <span className="grow" />
          <button type="button" className="btn btn--sm" onClick={onClose}>Cancel</button>
          <button className="btn btn--sm btn--primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Dialog>
  );
}
