// Server only. The board's tasks.
//
// Two kinds live side by side. Typed-in tasks belong to the Hub alone. Action
// items read out of the Notion meeting notes carry a pointer to the table row
// they came from, so ticking one off here also writes "Done" into that row,
// and the meeting notes stay the truth. Sync only ever adds tasks and closes
// them; it never reopens or rewrites one, so a change made here is never
// undone by Notion, and a task closed here stays closed if the write-back fails.
import { randomUUID } from "node:crypto";
import { currentTerm, ensureSchema, getSetting, setSetting, sql } from "./db";
import { isDay } from "./events";
import { fetchActionRows, notionConfigured, pushRowStatus, type TaskStatus } from "./notion";
import type { Status, SyncInfo, Task, TaskInput } from "./task-types";

export type { Task, TaskInput } from "./task-types";

const COLUMNS = `id, title, notes, owner_id, owner_name, to_char(due_on, 'YYYY-MM-DD') AS due_on, status, source, notion_url,
  meeting_title, notion_error, completed_at::text AS completed_at, completed_by`;

/** What makes two lines the same task: its words, ignoring case and punctuation. */
export const titleKey = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export type Who = { id: string; name: string };

export async function people(): Promise<Who[]> {
  await ensureSchema();
  return (await sql()`SELECT id, name FROM hub_people WHERE term = ${await currentTerm()} ORDER BY name`) as Who[];
}

/** The People row for whoever is signed in (matched by email or username), if any. */
export async function personFor(s: { email: string; username?: string }): Promise<string | null> {
  await ensureSchema();
  const rows = (await sql()`SELECT id FROM hub_people WHERE term = ${await currentTerm()}
    AND (lower(email) = lower(${s.email}) OR (${s.username ?? null}::text IS NOT NULL AND username = ${s.username ?? null}::text)) LIMIT 1`) as { id: string }[];
  return rows[0]?.id ?? null;
}

/** A first name written in the meeting notes → the one person it can only be.
 *  "TBD" and "Everyone" belong to nobody; two people with that first name are
 *  left for a person to pick. */
export function matchOwner(raw: string, list: Who[]): string | null {
  const first = norm(raw.split(/[,/&]|\band\b/i)[0] || "");
  if (!first || ["tbd", "everyone", "all", "board", "-"].includes(first)) return null;
  const hits = list.filter((p) => norm(p.name) === first || norm(p.name).split(/\s+/)[0] === first);
  return hits.length === 1 ? hits[0].id : null;
}

export async function listTasks(): Promise<Task[]> {
  await ensureSchema();
  return (await sql().query(`SELECT ${COLUMNS} FROM hub_tasks
    WHERE status <> 'dismissed' AND (status <> 'done' OR completed_at > now() - interval '45 days')
    ORDER BY due_on NULLS LAST, created_at`)) as Task[];
}

export async function taskCounts(today: string) {
  await ensureSchema();
  const [r] = (await sql()`SELECT
      count(*) FILTER (WHERE due_on < ${today}::date)::int AS overdue,
      count(*) FILTER (WHERE due_on >= ${today}::date AND due_on <= ${today}::date + 7)::int AS week,
      count(*)::int AS open
    FROM hub_tasks WHERE status IN ('open', 'in_progress', 'blocked')`) as { overdue: number; week: number; open: number }[];
  return r;
}

const T_COLUMNS = `t.id, t.title, t.notes, t.owner_id, t.owner_name, to_char(t.due_on, 'YYYY-MM-DD') AS due_on, t.status, t.source,
  t.notion_url, t.meeting_title, t.notion_error, t.completed_at::text AS completed_at, t.completed_by`;

/** Open tasks that are past due (oldest first), or due within a week (soonest first). */
export async function dueTasks(today: string, which: "overdue" | "soon", limit: number): Promise<(Task & { owner_label: string })[]> {
  await ensureSchema();
  const where = which === "overdue" ? "t.due_on < $1::date" : "t.due_on >= $1::date AND t.due_on <= $1::date + 7";
  return (await sql().query(`SELECT ${T_COLUMNS}, COALESCE(p.name, NULLIF(t.owner_name, ''), '') AS owner_label
    FROM hub_tasks t LEFT JOIN hub_people p ON p.id = t.owner_id
    WHERE t.status IN ('open', 'in_progress', 'blocked') AND ${where}
    ORDER BY t.due_on, t.created_at LIMIT $2`, [today, limit])) as (Task & { owner_label: string })[];
}

// --- changing tasks ----------------------------------------------------------------

export function checkTask(t: TaskInput): { ok: true; value: TaskInput } | { ok: false; error: string } {
  const title = String(t.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) return { ok: false, error: "Say what needs doing." };
  if (title.length > 300) return { ok: false, error: "The title is up to 300 characters." };
  const notes = String(t.notes ?? "").trim();
  if (notes.length > 2000) return { ok: false, error: "Notes are up to 2000 characters." };
  if (t.due_on !== null && !isDay(t.due_on)) return { ok: false, error: "The due date isn't a date." };
  if (!["open", "in_progress", "blocked", "done"].includes(t.status)) return { ok: false, error: "Pick a status." };
  const owner_name = String(t.owner_name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return { ok: true, value: { title, notes, owner_id: t.owner_id || null, owner_name, due_on: t.due_on || null, status: t.status } };
}

/** Write a Notion-sourced task's status into its meeting notes. Never throws: a
 *  task closed here stays closed, and the problem is kept on the task. */
async function writeBack(id: string): Promise<string | null> {
  const [t] = (await sql()`SELECT status, source, notion_block_id, notion_col FROM hub_tasks WHERE id = ${id}`) as
    { status: Status; source: string; notion_block_id: string | null; notion_col: number | null }[];
  if (!t || t.source !== "notion" || !t.notion_block_id || t.status === "dismissed" || !notionConfigured()) return null;
  try {
    await pushRowStatus(t.notion_block_id, t.notion_col ?? 3, t.status as TaskStatus);
    await sql()`UPDATE hub_tasks SET notion_error = NULL WHERE id = ${id}`;
    return null;
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    await sql()`UPDATE hub_tasks SET notion_error = ${msg} WHERE id = ${id}`;
    return msg;
  }
}

export const retryWriteBack = async (id: string) => { await ensureSchema(); return writeBack(id); };

const setStatusSql = (id: string, status: string, who: string) => sql()`UPDATE hub_tasks SET status = ${status},
  completed_at = CASE WHEN ${status}::text = 'done' THEN COALESCE(completed_at, now()) ELSE NULL END,
  completed_by = CASE WHEN ${status}::text = 'done' THEN COALESCE(completed_by, ${who}) ELSE NULL END,
  updated_at = now() WHERE id = ${id}`;

/** `warning` is set when the task changed here but couldn't be written to Notion. */
export async function setTaskStatus(id: string, status: Status, who: string): Promise<{ warning: string | null }> {
  await ensureSchema();
  const [before] = (await sql()`SELECT status FROM hub_tasks WHERE id = ${id}`) as { status: Status }[];
  if (!before) return { warning: null };
  await setStatusSql(id, status, who);
  return { warning: before.status !== status ? await writeBack(id) : null };
}

export async function saveTask(id: string | null, input: TaskInput, who: string): Promise<{ error: string | null; warning: string | null }> {
  const c = checkTask(input);
  if (!c.ok) return { error: c.error, warning: null };
  await ensureSchema();
  const v = c.value;
  if (v.owner_id) {
    const ok = (await sql()`SELECT 1 FROM hub_people WHERE id = ${v.owner_id}`).length > 0;
    if (!ok) return { error: "That person isn't on the People page.", warning: null };
  }
  // Someone picked from the list: the typed label ("Everyone", "TBD") no longer applies.
  const ownerName = v.owner_id ? "" : v.owner_name;
  if (!id) {
    const newId = randomUUID();
    await sql()`INSERT INTO hub_tasks (id, title, notes, owner_id, owner_name, due_on, status, source, title_key, created_by)
      VALUES (${newId}, ${v.title}, ${v.notes}, ${v.owner_id}, ${ownerName}, ${v.due_on}::date, 'open', 'manual', ${titleKey(v.title)}, ${who})`;
    if (v.status !== "open") await setStatusSql(newId, v.status, who);
    return { error: null, warning: null };
  }
  const [before] = (await sql()`SELECT status, source FROM hub_tasks WHERE id = ${id}`) as { status: Status; source: string }[];
  if (!before) return { error: "That task is gone.", warning: null };
  // A task from the meeting notes keeps its words, so the next sync still knows it.
  const title = before.source === "notion" ? undefined : v.title;
  await sql()`UPDATE hub_tasks SET title = COALESCE(${title ?? null}::text, title), title_key = COALESCE(${title ? titleKey(title) : null}::text, title_key),
    notes = ${v.notes}, owner_id = ${v.owner_id}, owner_name = ${ownerName}, due_on = ${v.due_on}::date, updated_at = now() WHERE id = ${id}`;
  let warning: string | null = null;
  if (before.status !== v.status) {
    await setStatusSql(id, v.status, who);
    warning = await writeBack(id);
  }
  return { error: null, warning };
}

/** A typed-in task is deleted. One from the meeting notes is hidden instead, so
 *  the next sync doesn't bring it back; it stays in the notes. */
export async function removeTask(id: string) {
  await ensureSchema();
  await sql()`DELETE FROM hub_tasks WHERE id = ${id} AND source = 'manual'`;
  await sql()`UPDATE hub_tasks SET status = 'dismissed', updated_at = now() WHERE id = ${id} AND source = 'notion'`;
}

// --- from the Notion meeting notes -------------------------------------------------

export const getSyncInfo = () => getSetting<SyncInfo>("tasks_sync", null);

/** Read the open action items from the newest `scan` meetings and add the ones
 *  this board doesn't have yet. Anything Notion marks Done is closed here too. */
export async function syncNotion(scan = 3): Promise<{ imported: number; closed: number; pages: string[] }> {
  if (!notionConfigured()) throw new Error("Notion isn't set up yet (NOTION_TOKEN and NOTION_MEETINGS_DATA_SOURCE), so there's nothing to read.");
  await ensureSchema();
  const q = sql();
  try {
    const { rows, pages } = await fetchActionRows(scan);
    const team = await people();
    const known = new Map(((await q`SELECT id, title_key, status, source FROM hub_tasks`) as { id: string; title_key: string; status: Status; source: string }[])
      .map((t) => [t.title_key, t]));
    const seen = new Set<string>();
    let imported = 0, closed = 0;
    for (const r of rows) { // newest page first: the first time a task is seen is the row it's tied to
      const key = titleKey(r.task);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const have = known.get(key);
      if (have) {
        if (have.source !== "notion" || have.status === "dismissed") continue;
        if (r.status === "done" && have.status !== "done") {
          await q`UPDATE hub_tasks SET status = 'done', completed_at = now(), completed_by = 'Notion', notion_error = NULL, updated_at = now() WHERE id = ${have.id}`;
          closed++;
        } else if (have.status !== "done") {
          await q`UPDATE hub_tasks SET notion_block_id = ${r.blockId}, notion_col = ${r.col}, notion_page_id = ${r.pageId}, notion_url = ${r.pageUrl}, meeting_title = ${r.meeting} WHERE id = ${have.id}`;
        }
        continue;
      }
      if (r.status === "done") continue;
      const id = randomUUID();
      const owner = matchOwner(r.owner, team);
      await q`INSERT INTO hub_tasks (id, title, owner_id, owner_name, due_on, status, source, title_key, notion_block_id, notion_col, notion_page_id, notion_url, meeting_title, created_by)
        VALUES (${id}, ${r.task}, ${owner}, ${owner ? "" : r.owner}, ${r.due}::date, ${r.status}, 'notion', ${key}, ${r.blockId}, ${r.col}, ${r.pageId}, ${r.pageUrl}, ${r.meeting}, 'Notion')`;
      imported++;
    }
    await setSetting("tasks_sync", { at: new Date().toISOString(), imported, closed, pages } satisfies NonNullable<SyncInfo>);
    return { imported, closed, pages };
  } catch (err) {
    const info = await getSyncInfo();
    await setSetting("tasks_sync", { at: info?.at ?? new Date().toISOString(), imported: 0, closed: 0, pages: info?.pages ?? [], error: (err instanceof Error ? err.message : String(err)).slice(0, 400) });
    throw err;
  }
}
