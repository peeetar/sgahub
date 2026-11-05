// Server only. Files a meeting into the SGA Notion Meetings database, laid out
// the way the board's meeting notes already are: When / Attendees / Main
// decisions, one section per topic, an action-items table, the next meeting,
// then the machine transcript in a collapsed toggle at the bottom.
import type { MeetingNotes } from "./meetings";

// NOTION_BASE_URL is for local testing against a stand-in; unset in production.
const API = process.env.NOTION_BASE_URL || "https://api.notion.com/v1";
const VERSION = "2025-09-03"; // data sources (databases with several sources) need this

export const notionConfigured = () => !!process.env.NOTION_TOKEN && !!process.env.NOTION_MEETINGS_DATA_SOURCE;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${process.env.NOTION_TOKEN}`, "Notion-Version": VERSION, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // Notion allows about three requests a second; back off when told to.
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 1000 * (Number(res.headers.get("retry-after")) || attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Notion said ${res.status}: ${(await res.text().catch(() => "")).slice(0, 400)}`);
    return (await res.json()) as T;
  }
}

// --- rich text -----------------------------------------------------------------

type RT = Record<string, unknown>;
const txt = (content: string, ann: { bold?: boolean; italic?: boolean } = {}): RT[] => {
  // A text object holds at most 2000 characters.
  const out: RT[] = [];
  for (let i = 0; i < content.length || i === 0; i += 2000) {
    out.push({ type: "text", text: { content: content.slice(i, i + 2000) }, annotations: { bold: !!ann.bold, italic: !!ann.italic } });
    if (!content.length) break;
  }
  return out;
};
const dateMention = (start: string, end?: string): RT => ({
  type: "mention",
  mention: { type: "date", date: { start, ...(end ? { end } : {}), ...(start.includes("T") ? { time_zone: "Europe/Athens" } : {}) } },
});

const para = (rich: RT[]) => ({ object: "block", type: "paragraph", paragraph: { rich_text: rich } });
const h2 = (s: string) => ({ object: "block", type: "heading_2", heading_2: { rich_text: txt(s) } });
const bullet = (rich: RT[]) => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich } });
const cell = (rich: RT[]) => rich;

export type FileInput = {
  title: string;
  heldOn: string;      // YYYY-MM-DD
  startTime: string;   // HH:MM
  notes: MeetingNotes;
  transcript: string;
  minutes: number;
  attendeeIds: string[];
  projectIds: string[];
};

const addHour = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

function body(f: FileInput) {
  const n = f.notes;
  const blocks: unknown[] = [
    para([...txt("When: ", { bold: true }), dateMention(`${f.heldOn}T${f.startTime}:00`, `${f.heldOn}T${addHour(f.startTime)}:00`)]),
    para([...txt("Attendees: ", { bold: true }), ...txt(n.attendees_line)]),
    para([...txt("Main decisions: ", { bold: true }), ...txt(n.main_decisions)]),
  ];
  n.sections.forEach((s, i) => {
    blocks.push(h2(`${i + 1}. ${s.title}`));
    for (const b of s.bullets) blocks.push(bullet([...(b.label ? txt(`${b.label}: `, { bold: true }) : []), ...txt(b.text)]));
  });
  blocks.push(h2(`${n.sections.length + 1}. Action items`));
  blocks.push(para(txt("Owners marked TBD weren't clear from the recording. Open items from earlier meetings stay open.")));
  const rows = n.action_items.length ? n.action_items : [{ task: "", owner: "", due: "", status: "" }];
  blocks.push({
    object: "block", type: "table",
    table: {
      table_width: 4, has_column_header: true, has_row_header: false,
      children: [
        { type: "table_row", table_row: { cells: [txt("Task"), txt("Owner"), txt("Due"), txt("Status")].map(cell) } },
        ...rows.map((a) => ({ type: "table_row", table_row: { cells: [
          txt(a.task), txt(a.owner), /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? [dateMention(a.due)] : txt(a.due), txt(a.status),
        ] } })),
      ],
    },
  });
  if (/^\d{4}-\d{2}-\d{2}$/.test(n.next_meeting.date)) {
    const t = /^\d{2}:\d{2}$/.test(n.next_meeting.time) ? n.next_meeting.time : "";
    blocks.push(para([...txt("Next meeting: ", { bold: true }), dateMention(t ? `${n.next_meeting.date}T${t}:00` : n.next_meeting.date)]));
  }
  blocks.push({ object: "block", type: "divider", divider: {} });
  return blocks;
}

/** Create the page, then add the transcript toggle and fill it 100 lines at a
 *  time (Notion's limit per request). Returns the page URL. */
export async function fileMeeting(f: FileInput): Promise<string> {
  const properties: Record<string, unknown> = {
    Meetings: { title: txt(f.title) },
    Summary: { rich_text: txt(f.notes.summary.slice(0, 1900)) },
  };
  if (f.attendeeIds.length) properties.Attendees = { people: f.attendeeIds.map((id) => ({ object: "user", id })) };
  if (f.projectIds.length) properties.Projects = { relation: f.projectIds.map((id) => ({ id })) };

  const page = await call<{ id: string; url: string }>("POST", "/pages", {
    parent: { type: "data_source_id", data_source_id: process.env.NOTION_MEETINGS_DATA_SOURCE },
    properties,
    children: body(f).slice(0, 100),
  });
  const rest = body(f).slice(100);
  for (let i = 0; i < rest.length; i += 100) await call("PATCH", `/blocks/${page.id}/children`, { children: rest.slice(i, i + 100) });

  const lines = f.transcript.split("\n").map((l) => l.trim()).filter(Boolean);
  const intro = para(txt(`Machine transcript of the ${f.minutes}-minute recording. Recurring name errors are fixed. Speakers aren't labelled and some words are misheard, so check the audio before quoting anyone.`, { italic: true }));
  const added = await call<{ results: { id: string }[] }>("PATCH", `/blocks/${page.id}/children`, {
    children: [{ object: "block", type: "heading_2", heading_2: { rich_text: txt("Transcript (auto-generated)"), is_toggleable: true, children: [intro] } }],
  });
  const toggle = added.results[0].id;
  for (let i = 0; i < lines.length; i += 100) {
    await call("PATCH", `/blocks/${toggle}/children`, { children: lines.slice(i, i + 100).map((l) => para(txt(l))) });
  }
  return page.url;
}

/** Project pages to tag a meeting with, by title. Optional: only when
 *  NOTION_PROJECTS_DATA_SOURCE is set. */
export async function listProjects(): Promise<{ id: string; title: string }[]> {
  const ds = process.env.NOTION_PROJECTS_DATA_SOURCE;
  if (!ds || !process.env.NOTION_TOKEN) return [];
  const out: { id: string; title: string }[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 5; i++) {
    const res = await call<{ results: { id: string; properties: Record<string, { type: string; title?: { plain_text: string }[] }> }[]; has_more: boolean; next_cursor?: string }>(
      "POST", `/data_sources/${ds}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    for (const p of res.results) {
      const t = Object.values(p.properties).find((v) => v.type === "title");
      const title = (t?.title || []).map((x) => x.plain_text).join("").trim();
      if (title) out.push({ id: p.id, title });
    }
    if (!res.has_more || !res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return out;
}

// --- action items: reading them out of the meeting notes, and ticking them off ----
//
// A meeting page carries its action items as tables (Task | Owner | Due |
// Status) under a heading such as "Action items" or "Open tasks". Newer pages
// also carry the earlier meetings' open items forward, so the Hub looks only
// at the latest few pages, newest first, and the first time a task is seen
// is the row it's tied to.

type NotionRT = { type: string; plain_text?: string; href?: string | null; annotations?: Record<string, unknown>;
  text?: { content: string; link?: { url: string } | null };
  mention?: { type: string; date?: { start: string; end?: string | null; time_zone?: string | null }; page?: { id: string } } };

const plainText = (rt: NotionRT[] = []) => rt.map((t) => t.plain_text ?? t.text?.content ?? "").join("").replace(/\s+/g, " ").trim();

/** A date written as a Notion date mention, or as YYYY-MM-DD in the text. */
function dueOf(rt: NotionRT[] = []): string | null {
  const m = rt.find((t) => t.type === "mention" && t.mention?.type === "date");
  const start = m?.mention?.date?.start;
  if (start) return start.slice(0, 10);
  return plainText(rt).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

export type TaskStatus = "open" | "in_progress" | "blocked" | "done";
const statusOf = (s: string): TaskStatus =>
  /done|complete/i.test(s) ? "done"
  : /block/i.test(s) ? "blocked"
  : /not started|to ?do/i.test(s) ? "open"
  : /progress|doing|started/i.test(s) ? "in_progress"
  : "open";
export const NOTION_STATUS: Record<TaskStatus, string> = { open: "Not started", in_progress: "In progress", blocked: "Blocked", done: "Done" };

export type ActionRow = {
  blockId: string; col: number; pageId: string; pageUrl: string; meeting: string;
  task: string; owner: string; due: string | null; status: TaskStatus;
};

type Block = { id: string; type: string; has_children?: boolean;
  table?: { has_column_header?: boolean };
  table_row?: { cells: NotionRT[][] };
  [k: string]: unknown };

async function children(id: string): Promise<Block[]> {
  const out: Block[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await call<{ results: Block[]; has_more: boolean; next_cursor?: string }>(
      "GET", `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    out.push(...res.results);
    if (!res.has_more || !res.next_cursor) break;
    cursor = res.next_cursor;
  }
  return out;
}

/** The action-item rows on one meeting page, in the order they're written. */
async function rowsOnPage(page: { id: string; url: string; title: string }): Promise<ActionRow[]> {
  const out: ActionRow[] = [];
  let inSection = false;
  for (const b of await children(page.id)) {
    if (b.type === "heading_1" || b.type === "heading_2" || b.type === "heading_3") {
      const rich = (b[b.type] as { rich_text?: NotionRT[] } | undefined)?.rich_text;
      inSection = /action items|open tasks/i.test(plainText(rich));
      continue;
    }
    if (b.type !== "table" || !inSection) continue;
    const rows = (await children(b.id)).filter((r) => r.type === "table_row" && r.table_row);
    const head = b.table?.has_column_header ? rows.shift() : undefined;
    const names = (head?.table_row?.cells ?? []).map((c) => plainText(c).toLowerCase());
    const find = (re: RegExp, fallback: number) => { const i = names.findIndex((n) => re.test(n)); return i >= 0 ? i : fallback; };
    const [iTask, iOwner, iDue, iStatus] = [find(/task|item|action/, 0), find(/owner|who|assign/, 1), find(/due|date|deadline/, 2), find(/status|state/, 3)];
    for (const r of rows) {
      const cells = r.table_row!.cells;
      const task = plainText(cells[iTask]);
      if (!task) continue;
      out.push({ blockId: r.id, col: iStatus, pageId: page.id, pageUrl: page.url, meeting: page.title, task,
        owner: plainText(cells[iOwner]), due: dueOf(cells[iDue]), status: statusOf(plainText(cells[iStatus])) });
    }
  }
  return out;
}

/** Action items from the newest `meetings` pages of the Meetings database. */
export async function fetchActionRows(meetings: number): Promise<{ rows: ActionRow[]; pages: string[] }> {
  const ds = process.env.NOTION_MEETINGS_DATA_SOURCE;
  const res = await call<{ results: { id: string; url: string; properties: Record<string, { type: string; title?: NotionRT[] }> }[] }>(
    "POST", `/data_sources/${ds}/query`, { page_size: Math.max(1, Math.min(10, meetings)), sorts: [{ timestamp: "created_time", direction: "descending" }] });
  const rows: ActionRow[] = [];
  const pages: string[] = [];
  for (const p of res.results) {
    const title = plainText(Object.values(p.properties).find((v) => v.type === "title")?.title) || "Meeting";
    pages.push(title);
    rows.push(...await rowsOnPage({ id: p.id, url: p.url, title }));
  }
  return { rows, pages };
}

/** One cell of a rich-text array, rebuilt so Notion accepts it back (the
 *  read-only fields it sends are dropped; a mention it can't rebuild stays as text). */
function backToInput(t: NotionRT): RT {
  const ann = t.annotations ? { annotations: t.annotations } : {};
  if (t.type === "mention" && t.mention?.type === "date" && t.mention.date) {
    const { start, end, time_zone } = t.mention.date;
    return { type: "mention", mention: { type: "date", date: { start, ...(end ? { end } : {}), ...(time_zone ? { time_zone } : {}) } }, ...ann };
  }
  if (t.type === "mention" && t.mention?.type === "page" && t.mention.page) {
    return { type: "mention", mention: { type: "page", page: { id: t.mention.page.id } }, ...ann };
  }
  const link = t.text?.link?.url ? { link: { url: t.text.link.url } } : {};
  return { type: "text", text: { content: t.plain_text ?? t.text?.content ?? "", ...link }, ...ann };
}

/** Write a status into the Status cell of the table row a task came from, and
 *  leave every other cell as it was. Needs the integration's "Update content" permission. */
export async function pushRowStatus(blockId: string, col: number, status: TaskStatus): Promise<void> {
  const block = await call<Block>("GET", `/blocks/${blockId}`);
  if (block.type !== "table_row" || !block.table_row) throw new Error("That row is no longer in the meeting notes.");
  const cells = block.table_row.cells.map((cell) => cell.map(backToInput));
  if (col < 0 || col >= cells.length) throw new Error("The table doesn't have a Status column.");
  cells[col] = txt(NOTION_STATUS[status]);
  await call("PATCH", `/blocks/${blockId}`, { table_row: { cells } });
}
