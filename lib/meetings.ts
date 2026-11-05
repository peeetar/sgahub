// Server only. A meeting recording becomes notes in Notion in four steps, each
// saved before the next starts, so a failure picks up where it stopped:
//
//   upload      the recording goes from the private Blob store to Gemini
//   transcribe  Gemini writes a timestamped transcript; known mis-hearings
//               (the board's fixes list) are corrected
//   notes       Gemini turns the transcript into the board's notes format
//   notion      the page is filed in the Meetings database, and the audio is
//               deleted from Blob (the original stays on the recorder's phone)
//
// One step runs per request (/api/meetings/<id>/step), driven by the Meetings
// page, so no single function has to outlive the platform's time limit.
import { get, del } from "@vercel/blob";
import { ensureSchema, getSetting, sql } from "./db";
import { noteNextMeeting } from "./events";
import { deleteFile, generate, uploadFile, type GeminiFile } from "./gemini";
import { fileMeeting, listProjects, notionConfigured } from "./notion";
import { syncNotion } from "./tasks";

export type Step = "upload" | "transcribe" | "notes" | "notion" | "done";
export const STEP_LABEL: Record<Step, string> = {
  upload: "Sending to Gemini", transcribe: "Transcribing", notes: "Writing the notes", notion: "Filing in Notion", done: "Done",
};
const NEXT: Record<Exclude<Step, "done">, Step> = { upload: "transcribe", transcribe: "notes", notes: "notion", notion: "done" };

export const KINDS = { board: "SGA board meeting", dean: "Meeting with the Dean", other: "Other meeting" } as const;
export type Kind = keyof typeof KINDS;

export type MeetingNotes = {
  summary: string;
  attendees_line: string;
  main_decisions: string;
  sections: { title: string; bullets: { label: string; text: string }[] }[];
  action_items: { task: string; owner: string; due: string; status: string }[];
  next_meeting: { date: string; time: string };
  projects: string[];
  unclear: string[];
  assumptions: string[];
};

export type Meeting = {
  id: string; title: string; kind: Kind; held_on: string; start_time: string; attendees: string[]; others: string;
  audio_path: string | null; status: Step; running_since: string | null; error: string | null;
  gemini_file: string | null; transcript: string | null; notes: MeetingNotes | null; notion_url: string | null;
  created_by: string; created_at: string;
};

export async function getMeeting(id: string): Promise<Meeting | null> {
  await ensureSchema();
  const rows = (await sql()`SELECT id, title, kind, to_char(held_on, 'YYYY-MM-DD') AS held_on, start_time, attendees, others, audio_path,
    status, running_since::text AS running_since, error, gemini_file, transcript, notes, notion_url, created_by, created_at::text AS created_at
    FROM hub_meetings WHERE id = ${id}`) as Meeting[];
  return rows[0] ?? null;
}

export async function listMeetings(): Promise<Omit<Meeting, "transcript">[]> {
  await ensureSchema();
  return (await sql()`SELECT id, title, kind, to_char(held_on, 'YYYY-MM-DD') AS held_on, start_time, attendees, others, audio_path,
    status, running_since::text AS running_since, error, gemini_file, NULL AS transcript, notes, notion_url, created_by, created_at::text AS created_at
    FROM hub_meetings ORDER BY held_on DESC, created_at DESC LIMIT 100`) as Meeting[];
}

/** The board's words that speech recognition gets wrong, one per line:
 *  `Sweden government => Student Government`. Kept in settings, not code,
 *  because they're mostly people's names. */
export async function fixes(): Promise<[RegExp, string][]> {
  const raw = await getSetting<string>("meeting_fixes", "");
  return raw.split("\n").map((l) => l.split("=>").map((s) => s.trim())).filter((p) => p.length === 2 && p[0] && p[1])
    .flatMap(([from, to]) => from.split(/\s*[,/]\s*/).filter(Boolean).map((f) =>
      [new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), to] as [RegExp, string]));
}

export const applyFixes = (text: string, list: [RegExp, string][]) => list.reduce((t, [re, to]) => t.replace(re, to), text);

/** Claim the next step, so two open tabs can't both run it. A claim older
 *  than six minutes belonged to a run that died. */
async function claim(id: string): Promise<Meeting | null> {
  await ensureSchema();
  const rows = (await sql()`UPDATE hub_meetings SET running_since = now(), updated_at = now()
    WHERE id = ${id} AND status <> 'done' AND (running_since IS NULL OR running_since < now() - interval '6 minutes')
    RETURNING id`) as { id: string }[];
  return rows.length ? getMeeting(id) : null;
}

type People = { id: string; name: string; role: string | null; notion_user_id: string | null }[];

async function boardFor(m: Meeting): Promise<People> {
  return (await sql()`SELECT p.id, p.name, r.title AS role, p.notion_user_id FROM hub_people p LEFT JOIN hub_roles r ON r.id = p.role_id
    WHERE p.id = ANY(${m.attendees})`) as People;
}

const ordinal = (n: number) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
export const shortDate = (day: string) => {
  const d = new Date(day + "T12:00:00Z");
  return `${ordinal(d.getUTCDate())} ${d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}`;
};

export async function runStep(id: string): Promise<{ ok: boolean; status?: Step; error?: string; busy?: boolean }> {
  const m = await claim(id);
  if (!m) return { ok: false, busy: true };
  const q = sql();
  const finish = async (patch: { status?: Step; error?: string | null }) => {
    await q`UPDATE hub_meetings SET status = ${patch.status ?? m.status}, error = ${patch.error ?? null}, running_since = NULL, updated_at = now() WHERE id = ${id}`;
  };
  try {
    const step = m.status as Exclude<Step, "done">;
    if (step === "upload") await stepUpload(m);
    if (step === "transcribe") await stepTranscribe(m);
    if (step === "notes") await stepNotes(m);
    if (step === "notion") await stepNotion(m);
    await finish({ status: NEXT[step] });
    return { ok: true, status: NEXT[step] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Gemini forgets uploads after 48 hours; send the recording again.
    const expired = m.status === "transcribe" && /\b(403|404)\b|not exist|PERMISSION_DENIED|NOT_FOUND/i.test(msg);
    await finish({ status: expired ? "upload" : m.status, error: msg.slice(0, 1000) });
    return { ok: false, error: msg };
  }
}

async function stepUpload(m: Meeting) {
  if (!m.audio_path) throw new Error("The recording is gone from storage. Upload it again as a new meeting.");
  const blob = await get(m.audio_path, { access: "private" });
  if (!blob || blob.statusCode !== 200) throw new Error("Couldn't read the recording from storage.");
  const bytes = new Uint8Array(await new Response(blob.stream).arrayBuffer());
  const mime = blob.blob.contentType === "video/quicktime" ? "audio/mp4" : blob.blob.contentType || "audio/mp4";
  const file = await uploadFile(bytes, mime, m.title);
  await sql()`UPDATE hub_meetings SET gemini_file = ${JSON.stringify(file)} WHERE id = ${m.id}`;
}

async function stepTranscribe(m: Meeting) {
  const file = JSON.parse(m.gemini_file || "null") as GeminiFile | null;
  if (!file) throw new Error("No uploaded recording; sending it again.");
  const people = await boardFor(m);
  const context = await getSetting<string>("meeting_context", "");
  const { text, truncated } = await generate([
    { file_data: { mime_type: file.mimeType, file_uri: file.uri } },
    { text: [
      "Transcribe this meeting recording word for word, in English.",
      "Write one line per sentence or short turn, each starting with the time from the start of the recording as [mm:ss] (or [h:mm:ss] after an hour).",
      "Don't label speakers, don't summarise, don't add anything that wasn't said, don't fix grammar. Leave out filler like um and uh.",
      "Where a word can't be made out, write [unclear]. Don't guess names you can't hear.",
      people.length ? `People who may be speaking: ${people.map((p) => p.name).join(", ")}${m.others ? `; also ${m.others}` : ""}.` : "",
      context ? `Names and terms that come up (use these spellings):\n${context}` : "",
    ].filter(Boolean).join("\n") },
  ], { thinking: 0 });
  const transcript = applyFixes(text.trim(), await fixes()) + (truncated ? "\n[transcript cut short: the recording was longer than Gemini could write out in one go]" : "");
  await sql()`UPDATE hub_meetings SET transcript = ${transcript} WHERE id = ${m.id}`;
  await deleteFile(file.name);
}

const NOTES_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING", description: "One paragraph, for the Summary column of the Meetings database." },
    attendees_line: { type: "STRING", description: "Who was there with their role, e.g. 'Alex (President), Sam (VP for Student Affairs); advisor X.' Then who was absent and why, if said. End with: 'Names are from the recording, so add anyone missing.'" },
    main_decisions: { type: "STRING", description: "One short paragraph. End with: 'Section N lists the action items.' where N is the action items section number (number of sections + 1)." },
    sections: { type: "ARRAY", description: "One per topic, in the order discussed. No small talk.", items: {
      type: "OBJECT", properties: {
        title: { type: "STRING" },
        bullets: { type: "ARRAY", items: { type: "OBJECT", properties: {
          label: { type: "STRING", description: "Optional bold lead-in: 'Decision', 'Raise with the Dean', 'Open question', or empty." },
          text: { type: "STRING", description: "Plain sentences, one fact per bullet." },
        }, required: ["label", "text"] } },
      }, required: ["title", "bullets"] } },
    action_items: { type: "ARRAY", items: { type: "OBJECT", properties: {
      task: { type: "STRING" }, owner: { type: "STRING", description: "First name, or TBD if not clear." },
      due: { type: "STRING", description: "YYYY-MM-DD if a date was said or clearly implied, else empty." },
      status: { type: "STRING", enum: ["Not started", "In progress", "Done", "Blocked"] },
    }, required: ["task", "owner", "due", "status"] } },
    next_meeting: { type: "OBJECT", properties: { date: { type: "STRING", description: "YYYY-MM-DD or empty" }, time: { type: "STRING", description: "HH:MM or empty" } }, required: ["date", "time"] },
    projects: { type: "ARRAY", items: { type: "STRING" }, description: "Titles from the given project list that were discussed. Exact titles only." },
    unclear: { type: "ARRAY", items: { type: "STRING" }, description: "Things that couldn't be made out or were ambiguous in the recording." },
    assumptions: { type: "ARRAY", items: { type: "STRING" }, description: "Who-said-what and owners you inferred rather than heard." },
  },
  required: ["summary", "attendees_line", "main_decisions", "sections", "action_items", "next_meeting", "projects", "unclear", "assumptions"],
};

async function stepNotes(m: Meeting) {
  if (!m.transcript) throw new Error("No transcript yet.");
  const people = await boardFor(m);
  const context = await getSetting<string>("meeting_context", "");
  const projects = await listProjects().catch(() => []);
  const [prev] = (await sql()`SELECT title, notes FROM hub_meetings WHERE status = 'done' AND id <> ${m.id} AND held_on <= ${m.held_on}::date
    ORDER BY held_on DESC, created_at DESC LIMIT 1`) as { title: string; notes: MeetingNotes | null }[];
  const weekday = new Date(m.held_on + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const { text } = await generate([{ text: [
    `You write the minutes for the ACT Student Government Association (SGA). This is "${m.title}", a ${KINDS[m.kind].toLowerCase()} held on ${weekday} ${m.held_on} at ${m.start_time} (Europe/Athens).`,
    `Board members present: ${people.map((p) => `${p.name}${p.role ? ` (${p.role})` : ""}`).join(", ") || "not given"}.${m.others ? ` Also present: ${m.others}.` : ""}`,
    context ? `Who's who and terms:\n${context}` : "",
    projects.length ? `Projects in Notion (tag the ones discussed, exact titles): ${projects.map((p) => p.title).join(" | ")}` : "",
    prev?.notes?.action_items?.length ? `Open action items from the previous meeting (${prev.title}), in case they come up: ${prev.notes.action_items.filter((a) => a.status !== "Done").map((a) => `${a.task} (${a.owner})`).join("; ")}` : "",
    "Rules:",
    "- Plain, concise English. Quotes only where they add something.",
    "- Don't record personal or private details people mention in passing.",
    "- If a speaker can't be identified, don't guess: say 'someone' and mark an owner TBD.",
    "- Double-check every number, date and weekday against the transcript; work out dates from the meeting date. Write 'about' instead of '~'.",
    "- The school is 'Anatolia American University' in public-facing text, never 'Anatolia University'.",
    "- Things to escalate to the Dean get a bullet labelled 'Raise with the Dean'.",
    "",
    "Transcript:",
    m.transcript,
  ].filter(Boolean).join("\n") }], { json: NOTES_SCHEMA, thinking: 4096 });
  let notes: MeetingNotes;
  try { notes = JSON.parse(text) as MeetingNotes; } catch { throw new Error("Gemini's notes weren't valid JSON; try again."); }
  await sql()`UPDATE hub_meetings SET notes = ${JSON.stringify(notes)}::jsonb WHERE id = ${m.id}`;
}

async function stepNotion(m: Meeting) {
  if (!notionConfigured()) throw new Error("Notion isn't set up (NOTION_TOKEN and NOTION_MEETINGS_DATA_SOURCE). The notes and transcript are saved here meanwhile.");
  if (!m.notes || !m.transcript) throw new Error("Notes aren't written yet.");
  const people = await boardFor(m);
  const projects = await listProjects().catch(() => []);
  const lines = m.transcript.split("\n").filter(Boolean);
  const last = lines[lines.length - 1]?.match(/^\[(?:(\d+):)?(\d+):(\d+)\]/);
  const minutes = last ? Math.max(1, Math.round((Number(last[1] || 0) * 3600 + Number(last[2]) * 60 + Number(last[3])) / 60)) : 0;
  const url = await fileMeeting({
    title: m.title, heldOn: m.held_on, startTime: m.start_time, notes: m.notes, transcript: m.transcript, minutes,
    attendeeIds: people.map((p) => p.notion_user_id).filter((x): x is string => !!x),
    projectIds: projects.filter((p) => m.notes!.projects.includes(p.title)).map((p) => p.id),
  });
  await sql()`UPDATE hub_meetings SET notion_url = ${url} WHERE id = ${m.id}`;
  // Best effort, and never a reason to fail the filing: the next meeting goes
  // on the calendar, and the new action items are pulled into Tasks.
  await noteNextMeeting(m.id, KINDS[m.kind], m.notes.next_meeting.date, m.notes.next_meeting.time).catch((err) => console.error("next meeting", err));
  await syncNotion(3).catch((err) => console.error("tasks sync", err));
  if (m.audio_path) {
    await del(m.audio_path).catch((err) => console.error("blob del", err));
    await sql()`UPDATE hub_meetings SET audio_path = NULL WHERE id = ${m.id}`;
  }
}
