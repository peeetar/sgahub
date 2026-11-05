// Server only. The board's calendar: school dates, SGA events, deadlines and
// meetings. Days are Athens days written YYYY-MM-DD, times are Athens HH:MM.
//
// Events come from three places: typed in on the Calendar page, a schedule
// pasted into Settings (one event per line), and the "next meeting" the Hub
// reads out of a meeting's notes. Each of the last two carries an `import_ref`
// so doing it twice never doubles anything up.
import { createHash, randomUUID } from "node:crypto";
import { ensureSchema, sql } from "./db";
import { CATEGORIES, isCategory, type Category, type EventInput, type EventRow } from "./event-types";

export { CATEGORIES, isCategory } from "./event-types";
export type { Category, EventInput, EventRow } from "./event-types";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isDay = (s: unknown): s is string => {
  if (typeof s !== "string" || !DAY_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`); // NaN for 2026-13-40, which toISOString would throw on
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; // and 2026-02-30 rolls over to March
};

/** `{ ok: true, value }` with the fields trimmed and normalised, or the first
 *  thing wrong, in words the person saving can act on. */
export function checkEvent(e: EventInput): { ok: true; value: Required<Omit<EventInput, "category">> & { category: Category } } | { ok: false; error: string } {
  const title = String(e.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) return { ok: false, error: "Give the event a title." };
  if (title.length > 120) return { ok: false, error: "The title is up to 120 characters." };
  if (!isDay(e.starts_on)) return { ok: false, error: "Pick a start date." };
  let ends: string | null = e.ends_on || null;
  if (ends !== null && !isDay(ends)) return { ok: false, error: "The end date isn't a date." };
  if (ends !== null && ends < e.starts_on) return { ok: false, error: "The event can't end before it starts." };
  if (ends === e.starts_on) ends = null;
  const start = e.start_time || null;
  const end = e.end_time || null;
  if (start !== null && !TIME_RE.test(start)) return { ok: false, error: "The start time is HH:MM." };
  if (end !== null && !TIME_RE.test(end)) return { ok: false, error: "The end time is HH:MM." };
  if (end !== null && start === null) return { ok: false, error: "Add a start time, or clear the end time." };
  if (start !== null && end !== null && ends === null && end <= start) return { ok: false, error: "The end time has to be after the start time." };
  const location = String(e.location ?? "").replace(/\s+/g, " ").trim();
  if (location.length > 120) return { ok: false, error: "The place is up to 120 characters." };
  const notes = String(e.notes ?? "").trim();
  if (notes.length > 1000) return { ok: false, error: "Notes are up to 1000 characters." };
  return { ok: true, value: { title, starts_on: e.starts_on, ends_on: ends, start_time: start, end_time: end, location, category: isCategory(e.category) ? e.category : "event", notes } };
}

const COLUMNS = `id, title, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on,
  start_time, end_time, location, category, notes, source`;

/** Events that touch any day from `from` to `to`, inclusive. */
export async function listEvents(from: string, to: string): Promise<EventRow[]> {
  await ensureSchema();
  return (await sql().query(
    `SELECT ${COLUMNS} FROM hub_events
     WHERE starts_on <= $2::date AND COALESCE(ends_on, starts_on) >= $1::date
     ORDER BY starts_on, start_time NULLS FIRST, title`, [from, to])) as EventRow[];
}

/** What is coming up: everything that hasn't finished by `today`, soonest first. */
export async function upcomingEvents(today: string, limit = 20): Promise<EventRow[]> {
  await ensureSchema();
  return (await sql().query(
    `SELECT ${COLUMNS} FROM hub_events
     WHERE COALESCE(ends_on, starts_on) >= $1::date
     ORDER BY starts_on, start_time NULLS FIRST, title LIMIT $2`, [today, limit])) as EventRow[];
}

export async function addEvent(e: EventInput, who: string, source = "manual", importRef: string | null = null): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const c = checkEvent(e);
  if (!c.ok) return c;
  await ensureSchema();
  const v = c.value;
  const id = randomUUID();
  const rows = (await sql()`INSERT INTO hub_events (id, title, starts_on, ends_on, start_time, end_time, location, category, notes, source, import_ref, created_by)
    VALUES (${id}, ${v.title}, ${v.starts_on}::date, ${v.ends_on}::date, ${v.start_time}, ${v.end_time}, ${v.location}, ${v.category}, ${v.notes}, ${source}, ${importRef}, ${who})
    ON CONFLICT (import_ref) DO NOTHING RETURNING id`) as { id: string }[];
  return { ok: true, id: rows[0]?.id ?? null };
}

export async function updateEvent(id: string, e: EventInput): Promise<string | null> {
  const c = checkEvent(e);
  if (!c.ok) return c.error;
  await ensureSchema();
  const v = c.value;
  await sql()`UPDATE hub_events SET title = ${v.title}, starts_on = ${v.starts_on}::date, ends_on = ${v.ends_on}::date,
    start_time = ${v.start_time}, end_time = ${v.end_time}, location = ${v.location}, category = ${v.category},
    notes = ${v.notes}, updated_at = now() WHERE id = ${id}`;
  return null;
}

/** Move an event to start on `day`, keeping its length. */
export async function moveEvent(id: string, day: string): Promise<string | null> {
  if (!isDay(day)) return "That isn't a date.";
  await ensureSchema();
  await sql()`UPDATE hub_events SET
    ends_on = CASE WHEN ends_on IS NULL THEN NULL ELSE ${day}::date + (ends_on - starts_on) END,
    starts_on = ${day}::date, updated_at = now() WHERE id = ${id}`;
  return null;
}

export async function deleteEvent(id: string) {
  await ensureSchema();
  await sql()`DELETE FROM hub_events WHERE id = ${id}`;
}

// --- a pasted schedule -----------------------------------------------------------

type Clean = Extract<ReturnType<typeof checkEvent>, { ok: true }>["value"];

const pad = (n: string | number) => String(n).padStart(2, "0");

/** 2026-11-09, 9/11/2026 or 9.11.2026 (day first, the way it's written here). */
export function parseDay(raw: string): string | null {
  const s = raw.trim();
  let iso: string | null = null;
  const a = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const b = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (a) iso = `${a[1]}-${pad(a[2])}-${pad(a[3])}`;
  else if (b) iso = `${b[3]}-${pad(b[2])}-${pad(b[1])}`;
  return iso && isDay(iso) ? iso : null;
}

const hhmm = (s: string) => {
  const m = s.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  const t = m ? `${pad(m[1])}:${m[2]}` : "";
  return TIME_RE.test(t) ? t : null;
};

const TIME_FIELD = /^(all[\s-]?day|\d{1,2}[:.]\d{2}(\s*[-–]\s*\d{1,2}[:.]\d{2})?)$/i;

function parseLine(line: string): { value: EventInput } | string {
  const cells = (line.includes("\t") ? line.split("\t") : line.split("|")).map((c) => c.trim());
  const [dates, ...rest] = cells;
  const [from, to] = dates.split(/\s*(?:\.\.|→|–|—|\bto\b)\s*/i);
  const starts_on = parseDay(from || "");
  if (!starts_on) return `"${dates}" isn't a date. Use 2026-11-09 or 9/11/2026.`;
  const ends_on = to ? parseDay(to) : null;
  if (to && !ends_on) return `"${to}" isn't a date.`;

  let start_time: string | null = null, end_time: string | null = null;
  const text: string[] = [];
  for (const cell of rest) {
    if (!cell) { text.push(""); continue; }
    if (start_time === null && TIME_FIELD.test(cell)) {
      if (/^all/i.test(cell)) continue;
      const [a, b] = cell.split(/\s*[-–]\s*/);
      start_time = hhmm(a);
      end_time = b ? hhmm(b) : null;
      if (!start_time || (b && !end_time)) return `"${cell}" isn't a time. Use 14:00 or 14:00-15:00.`;
      continue;
    }
    text.push(cell);
  }
  while (text.length && !text[text.length - 1]) text.pop();
  const [title = "", location = "", category = "", notes = ""] = text;
  if (!title) return "There's no title.";
  let cat: Category = "event";
  if (category) {
    const k = category.toLowerCase();
    const hit = (Object.entries(CATEGORIES) as [Category, string][]).find(([key, label]) => key === k || label.toLowerCase() === k);
    if (!hit) return `"${category}" isn't a category. Use ${Object.keys(CATEGORIES).join(", ")}.`;
    cat = hit[0];
  }
  return { value: { title, starts_on, ends_on, start_time, end_time, location, category: cat, notes } };
}

/** The ref a pasted line is known by: its first day and its title, so pasting
 *  the same list again adds nothing, and moving an event later doesn't make
 *  the next paste put it back. */
export const importRef = (day: string, title: string) =>
  "sched:" + createHash("sha1").update(`${day}|${title.toLowerCase().replace(/\s+/g, " ").trim()}`).digest("hex").slice(0, 24);

/** One event per line, fields split by `|` (or tabs, so a copied spreadsheet row works):
 *  `2026-11-09 | 14:00-15:00 | Coffee Space opening | Library | coffee | notes`
 *  The time can be left out, a date range is `2026-11-16..2026-11-20`, and
 *  lines starting with # are skipped. Nothing is added unless every line is fine. */
export function parseSchedule(text: string): { events: Clean[]; errors: string[] } {
  const events: Clean[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const p = parseLine(line);
    if (typeof p === "string") return errors.push(`Line ${i + 1}: ${p}`);
    const c = checkEvent(p.value);
    if (!c.ok) return errors.push(`Line ${i + 1}: ${c.error}`);
    events.push(c.value);
  });
  return { events, errors };
}

export async function importSchedule(text: string, who: string): Promise<{ added: number; existing: number; errors: string[] }> {
  const { events, errors } = parseSchedule(text);
  if (errors.length || !events.length) return { added: 0, existing: 0, errors: errors.length ? errors : ["There are no events in that text."] };
  await ensureSchema();
  const q = sql();
  const rows = await q.transaction(events.map((e) => q`INSERT INTO hub_events (id, title, starts_on, ends_on, start_time, end_time, location, category, notes, source, import_ref, created_by)
    VALUES (${randomUUID()}, ${e.title}, ${e.starts_on}::date, ${e.ends_on}::date, ${e.start_time}, ${e.end_time}, ${e.location}, ${e.category}, ${e.notes}, 'import', ${importRef(e.starts_on, e.title)}, ${who})
    ON CONFLICT (import_ref) DO NOTHING RETURNING id`)) as { id: string }[][];
  const added = rows.filter((r) => r.length).length;
  return { added, existing: events.length - added, errors: [] };
}

/** The "next meeting" a meeting's notes name, put on the calendar. Only the
 *  first time: if someone moves it, filing again won't move it back. */
export async function noteNextMeeting(meetingId: string, title: string, day: string, time: string) {
  if (!isDay(day) || day < new Date().toISOString().slice(0, 10)) return;
  await addEvent({ title, starts_on: day, start_time: TIME_RE.test(time) ? time : null, category: "meeting" }, "meeting notes", "meeting", `meeting-next:${meetingId}`);
}
