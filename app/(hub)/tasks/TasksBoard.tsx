"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Dialog } from "@/components/ui";
import { addDays, diffDays, fmtDay } from "@/lib/days";
import { ACTIVE, STATUS_LABEL, type Status, type SyncInfo, type Task } from "@/lib/task-types";
import { changeStatus, deleteTask, retryNotion, saveTaskAction, syncTasks } from "./actions";

type Who = { id: string; name: string };
type Filter = "all" | "mine" | "none" | string;

const isActive = (t: Task) => ACTIVE.includes(t.status);
const ago = (iso: string) => {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};

export default function TasksBoard({ tasks: fromServer, people, meId, today, sync, notion }: {
  tasks: Task[]; people: Who[]; meId: string | null; today: string; sync: SyncInfo; notion: boolean;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(fromServer);
  useEffect(() => setTasks(fromServer), [fromServer]);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [scan, setScan] = useState(3);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [syncing, startSync] = useTransition();
  const [, start] = useTransition();

  const ownerLabel = (t: Task) => (t.owner_id ? people.find((p) => p.id === t.owner_id)?.name : null) ?? (/^(tbd|)$/i.test(t.owner_name) ? "" : t.owner_name);
  const first = (n: string) => n.split(" ")[0];
  const visible = (t: Task) => filter === "all" ? true : filter === "mine" ? !!meId && t.owner_id === meId : filter === "none" ? !t.owner_id && !ownerLabel(t) : t.owner_id === filter;

  const active = tasks.filter((t) => isActive(t) && visible(t));
  const done = tasks.filter((t) => t.status === "done" && visible(t)).sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  const groups: [string, Task[], boolean][] = [
    ["Overdue", active.filter((t) => t.due_on && t.due_on < today), true],
    ["Today", active.filter((t) => t.due_on === today), false],
    ["Next 7 days", active.filter((t) => t.due_on && t.due_on > today && t.due_on <= addDays(today, 7)), false],
    ["Later", active.filter((t) => t.due_on && t.due_on > addDays(today, 7)), false],
    ["No date", active.filter((t) => !t.due_on), false],
  ];

  function setStatus(t: Task, status: Status) {
    const prev = tasks;
    setTasks((all) => all.map((x) => (x.id === t.id ? { ...x, status, completed_at: status === "done" ? new Date().toISOString() : null } : x)));
    setMsg(null);
    start(async () => {
      try {
        const r = await changeStatus(t.id, status);
        if (r.warning) setMsg({ tone: "bad", text: `Saved here, but Notion didn't take it: ${r.warning}` });
      } catch { setTasks(prev); setMsg({ tone: "bad", text: "Couldn't save that. Try again." }); }
      router.refresh();
    });
  }

  const dueLabel = (t: Task) => {
    if (!t.due_on) return null;
    const n = diffDays(t.due_on, today);
    if (t.status === "done") return <span className="muted small">{fmtDay(t.due_on, { day: "numeric", month: "short" })}</span>;
    if (n < 0) return <span className="pill pill--bad">{-n === 1 ? "1 day overdue" : `${-n} days overdue`}</span>;
    if (n === 0) return <span className="pill pill--warn">Today</span>;
    return <span className="pill pill--soft">{n === 1 ? "Tomorrow" : fmtDay(t.due_on, { weekday: "short", day: "numeric", month: "short" })}</span>;
  };

  const row = (t: Task) => {
    const who = ownerLabel(t);
    return (
      <li key={t.id} className={"task" + (t.status === "done" ? " is-done" : "")}>
        <button className="task__check" aria-label={t.status === "done" ? "Reopen" : "Mark done"} aria-pressed={t.status === "done"}
          onClick={() => setStatus(t, t.status === "done" ? "open" : "done")}>{t.status === "done" ? "✓" : ""}</button>
        <button className="task__main" onClick={() => setEditing(t)}>
          <strong>{t.title}</strong>
          <span className="task__meta">
            {t.status === "in_progress" && <span className="pill pill--soft">In progress</span>}
            {t.status === "blocked" && <span className="pill pill--bad">Blocked</span>}
            {t.source === "notion" && <span className="muted small">Notion{t.meeting_title ? ` · ${t.meeting_title}` : ""}</span>}
            {t.notion_error && <span className="pill pill--warn" title={t.notion_error}>Not updated in Notion</span>}
          </span>
        </button>
        <span className={"task__owner" + (who ? "" : " is-none")} title={who || "Nobody yet"}>{who ? (who === "Everyone" ? who : first(who)) : "Unassigned"}</span>
        <span className="task__due">{dueLabel(t)}</span>
      </li>
    );
  };

  const runSync = () => startSync(async () => {
    setMsg(null);
    const r = await syncTasks(scan);
    if (!r.ok) setMsg({ tone: "bad", text: r.error });
    else setMsg({ tone: "ok", text: r.imported || r.closed ? `${r.imported} new from Notion${r.closed ? `, ${r.closed} closed because Notion has them as done` : ""}.` : "Nothing new in Notion." });
    router.refresh();
  });

  return (
    <main className="hubpage">
      <header className="hubpage__head">
        <h1>Tasks</h1>
        <div className="row">
          <select className="field field--sm field--short" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Whose tasks">
            <option value="all">Everyone&apos;s</option>
            {meId && <option value="mine">Mine</option>}
            <option value="none">Unassigned</option>
            <optgroup label="Person">{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
          </select>
          <button className="btn btn--sm btn--primary" onClick={() => setEditing("new")}>+ Add task</button>
        </div>
      </header>

      <section className="panel tasks__sync">
        {notion ? (
          <div className="row">
            <button className="btn btn--sm" disabled={syncing} onClick={runSync}>{syncing ? "Reading Notion…" : "Sync from Notion"}</button>
            <label className="muted small">from the latest{" "}
              <select className="field field--sm field--tiny" value={scan} onChange={(e) => setScan(Number(e.target.value))} aria-label="How many meetings to read">
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>{" "}meeting{scan === 1 ? "" : "s"}</label>
            <span className="muted small grow">
              {sync?.error ? <span className="error">Last try failed: {sync.error}</span>
                : sync ? <>Last read {ago(sync.at)}{sync.pages.length ? ` · ${sync.pages.slice(0, 3).join(", ")}` : ""}. Runs by itself every morning too.</>
                : "Not read yet. Press the button to pull in the open action items."}
            </span>
          </div>
        ) : (
          <p className="muted small">Notion isn&apos;t connected, so only tasks typed in here show up. Once <code>NOTION_TOKEN</code> and <code>NOTION_MEETINGS_DATA_SOURCE</code> are set, the open action items from the meeting notes appear here, and ticking one off writes Done back into the notes. <a href="/settings">See Settings</a>.</p>
        )}
        {msg && <p className={msg.tone === "ok" ? "pos" : "error"}>{msg.text}</p>}
      </section>

      {groups.map(([label, list, bad]) => list.length > 0 && (
        <section key={label} className="panel">
          <header className="panel__head"><h2 className={bad ? "neg" : ""}>{label} <small className="muted">{list.length}</small></h2></header>
          <ul className="tasklist">{list.map(row)}</ul>
        </section>
      ))}
      {active.length === 0 && <div className="panel"><p className="muted">{tasks.some(isActive) ? "No open tasks match that." : "No open tasks. 🎉 Add one, or sync the action items from the meeting notes."}</p></div>}

      {done.length > 0 && (
        <section className="panel">
          <header className="panel__head">
            <h2>Done <small className="muted">{done.length}</small></h2>
            <button className="linkbtn" onClick={() => setShowDone(!showDone)}>{showDone ? "Hide" : "Show"}</button>
          </header>
          {showDone && <ul className="tasklist">{done.map(row)}</ul>}
        </section>
      )}

      {editing && <TaskDialog key={editing === "new" ? "new" : editing.id} task={editing === "new" ? null : editing} people={people} today={today}
        onClose={() => setEditing(null)} onSaved={(warning) => { setEditing(null); if (warning) setMsg({ tone: "bad", text: `Saved here, but Notion didn't take it: ${warning}` }); router.refresh(); }} />}
    </main>
  );
}

function TaskDialog({ task, people, today, onClose, onSaved }: {
  task: Task | null; people: Who[]; today: string; onClose: () => void; onSaved: (warning: string | null) => void;
}) {
  const fromNotion = task?.source === "notion";
  const initialOwner = task?.owner_id ?? (/^everyone$/i.test(task?.owner_name ?? "") ? "everyone" : "");
  const [f, setF] = useState({ title: task?.title ?? "", notes: task?.notes ?? "", owner: initialOwner, due_on: task?.due_on ?? "", status: (task?.status ?? "open") as Status });
  const [err, setErr] = useState<string | null>(null);
  const [retry, setRetry] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog title={task ? "Edit task" : "Add a task"} onClose={onClose}>
      <form className="stack" onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveTaskAction(task?.id ?? null, {
            title: f.title, notes: f.notes, owner_id: f.owner && f.owner !== "everyone" ? f.owner : null,
            owner_name: f.owner === "everyone" ? "Everyone" : "", due_on: f.due_on || null, status: f.status,
          });
          if (r.error) setErr(r.error); else onSaved(r.warning);
        });
      }}>
        <label className="lbl">What needs doing
          <input className="field field--sm" required autoFocus={!task} maxLength={300} value={f.title} onChange={set("title")} readOnly={fromNotion} placeholder="Order the napkins for the opening" />
        </label>
        {fromNotion && <p className="muted small">These words come from the meeting notes{task?.notion_url ? <> (<a href={task.notion_url} target="_blank" rel="noreferrer">open the page</a>)</> : ""}, so they stay as written.</p>}
        <div className="row">
          <label className="lbl grow">Who does it
            <select className="field field--sm" value={f.owner} onChange={set("owner")}>
              <option value="">Nobody yet</option>
              <option value="everyone">Everyone</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="lbl grow">Due<input className="field field--sm" type="date" value={f.due_on} min={task ? undefined : today} onChange={set("due_on")} /></label>
        </div>
        <label className="lbl">Status
          <select className="field field--sm" value={f.status} onChange={set("status")}>
            {(["open", "in_progress", "blocked", "done"] as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="lbl">Notes<textarea className="field field--sm" rows={2} maxLength={2000} value={f.notes} onChange={set("notes")} /></label>
        {fromNotion && <p className="muted small">Changing the status here writes it into the meeting notes. Owner, due date and notes stay in the Hub only.</p>}
        {task?.notion_error && (
          <p className="error small">Not updated in Notion: {task.notion_error}{" "}
            <button type="button" className="linkbtn" disabled={busy} onClick={() => start(async () => { const r = await retryNotion(task.id); if (r) setRetry(r); else onSaved(null); })}>Try again</button>
            {retry && <span> Still failing: {retry}</span>}</p>
        )}
        {err && <p className="error">{err}</p>}
        <div className="row">
          {task && <button type="button" className="btn btn--sm btn--out" disabled={busy} onClick={() => {
            if (confirm(fromNotion ? "Hide this task? It stays in the meeting notes but won't come back here." : `Delete "${task.title}"?`)) start(async () => { await deleteTask(task.id); onSaved(null); });
          }}>{fromNotion ? "Hide" : "Delete"}</button>}
          <span className="grow" />
          <button type="button" className="btn btn--sm" onClick={onClose}>Cancel</button>
          <button className="btn btn--sm btn--primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Dialog>
  );
}
