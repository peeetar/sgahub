// Server only. Marketing HQ: one JSON document per tool, saved with a version
// so two people editing at once get told instead of overwriting each other.
//
// Documents stay dumb on purpose. The defaults, the copy and the canvas drawing
// live in the browser (components/marketing); here we only bound what can be
// stored and never let an image into the database. This repo is public, so
// anything naming a person lives in these documents, never in the code.
import { currentTerm, ensureSchema, getSetting, setSetting, sql } from "./db";
import { piGet, type PiLaunch } from "./pi";

export const TOOLS = ["overview", "announce", "flavour", "howto", "linkedin", "cv"] as const;
export type Tool = (typeof TOOLS)[number];
export const isTool = (t: string): t is Tool => (TOOLS as readonly string[]).includes(t);
export const GROUPS = ["SGA", "Maker's Society", "Library"];

const MAX_DOC_BYTES = 64 * 1024;
const MAX_DEPTH = 6;
const PI_MS = 3000;   // the tools work without the kiosk, so don't wait long for it

/** The message is shown to the person saving. */
export class BadDoc extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function walk(value: unknown, depth = 0) {
  if (depth > MAX_DEPTH) throw new BadDoc("That document is nested too deeply.");
  if (Array.isArray(value)) value.forEach((v) => walk(v, depth + 1));
  else if (isObj(value)) Object.values(value).forEach((v) => walk(v, depth + 1));
  else if (typeof value === "string") {
    if (value.trimStart().slice(0, 5).toLowerCase() === "data:") {
      throw new BadDoc("Images aren't stored in the document. Pick a capsule from the catalogue, or keep the picture for this session only.");
    }
  } else if (value !== null && !["boolean", "number"].includes(typeof value)) {
    throw new BadDoc("Only text, numbers, lists and objects can be saved.");
  }
}

export function checkDoc(tool: string, doc: unknown): asserts doc is Obj {
  if (!isTool(tool)) throw new BadDoc(`There is no tool called ${tool}.`);
  if (!isObj(doc)) throw new BadDoc("A document is an object.");
  walk(doc);
  if (Buffer.byteLength(JSON.stringify(doc)) > MAX_DOC_BYTES) throw new BadDoc(`That document is over ${MAX_DOC_BYTES / 1024} KB. Trim some text.`);
}

export type Person = { id: string; name: string; email: string | null };

/** This term's People page: the one team list every tool reads. */
export async function team(): Promise<Person[]> {
  await ensureSchema();
  const term = await currentTerm();
  return (await sql()`SELECT p.id, p.name, p.email FROM hub_people p LEFT JOIN hub_roles r ON r.id = p.role_id
    WHERE p.term = ${term} ORDER BY r.sort NULLS LAST, p.name`) as Person[];
}

type Row = { tool: string; doc: Obj; version: number; updated_at: string; updated_by: string | null };

const nameOf = (people: Person[], email: string | null) =>
  people.find((p) => p.email?.toLowerCase() === email?.toLowerCase())?.name || email;

function shape(row: Row | undefined, people: Person[]) {
  if (!row) return { doc: null, version: 0, updated_at: null, updated_by: null, updated_by_name: null };
  return { doc: row.doc, version: row.version, updated_at: row.updated_at, updated_by: row.updated_by, updated_by_name: nameOf(people, row.updated_by) };
}

const docRow = async (tool: string) =>
  ((await sql()`SELECT * FROM hub_marketing_docs WHERE tool = ${tool}`) as Row[])[0];

/** What the kiosk knows, remembered so a kiosk that's off doesn't blank the
 *  prices and numbers on a post someone is writing. */
async function kioskFacts(actor: string) {
  const [config, launch] = await Promise.all([
    piGet<{ bundles: { cents: number; coffees: number }[] }>("/config", actor, PI_MS),
    piGet<PiLaunch>("/launch-numbers", actor, PI_MS),
  ]);
  const last = await getSetting("marketing_kiosk", {
    bundles: [] as { cents: number; coffees: number }[],
    launch: { coffees_served: 0, students_registered: 0, flavours_offered: 0, days_running: 0 } as PiLaunch,
  });
  const facts = {
    bundles: config.ok ? config.bundles : last.bundles,
    launch: launch.ok ? { coffees_served: launch.coffees_served, students_registered: launch.students_registered,
      flavours_offered: launch.flavours_offered, days_running: launch.days_running } : last.launch,
  };
  if (JSON.stringify(facts) !== JSON.stringify(last)) await setSetting("marketing_kiosk", facts);
  return { ...facts, pi_ok: config.ok && launch.ok };
}

export async function workspace(actor: string) {
  await ensureSchema();
  const [people, rows, facts] = await Promise.all([team(), sql()`SELECT * FROM hub_marketing_docs`, kioskFacts(actor)]);
  const docs = Object.fromEntries(TOOLS.map((t) => [t, shape((rows as Row[]).find((r) => r.tool === t), people)]));
  return { ...facts, team: people, groups: GROUPS, docs };
}

/** Saves `doc` if `version` is still current. `saved: false` is a conflict, and
 *  `row` is what's there now, so the person can see who got in first. */
export async function saveDoc(tool: string, doc: Obj, version: number, actor: string) {
  await ensureSchema();
  const json = JSON.stringify(doc);
  const rows = (version === 0
    ? await sql()`INSERT INTO hub_marketing_docs (tool, doc, updated_by) VALUES (${tool}, ${json}::jsonb, ${actor})
        ON CONFLICT (tool) DO NOTHING RETURNING *`
    : await sql()`UPDATE hub_marketing_docs SET doc = ${json}::jsonb, version = version + 1, updated_at = now(), updated_by = ${actor}
        WHERE tool = ${tool} AND version = ${version} RETURNING *`) as Row[];
  const people = await team();
  return rows[0] ? { saved: true, ...shape(rows[0], people) } : { saved: false, ...shape(await docRow(tool), people) };
}

// --- bringing things in ----------------------------------------------------------

// What the old single-file tool shipped as its example launch numbers. A value
// equal to one of these was never typed in, so importing it as an override
// would put made-up numbers on a post.
const OLD_EXAMPLE_STATS: Record<string, string> = { coffees: "300+", students: "120", flavours: "6", days: "30" };
const LEGACY_KEYS = {
  ann: ["theme", "eyebrow", "headline", "body", "dateLabel", "date", "prices", "handle", "caption"],
  fl: ["bg", "eyebrow", "name", "notes", "intensity", "avail", "scale"],
  li: ["imgTitle", "imgSub", "opener", "story", "host", "next", "tags"],
  person: ["org", "start", "end", "bullets", "skills"],
};

function pick(source: unknown, keys: string[]): Obj {
  const from = isObj(source) ? source : {};
  return Object.fromEntries(keys.filter((k) => from[k] !== undefined && from[k] !== null).map((k) => [k, from[k]]));
}

type Plan = { docs: Record<string, Obj>; credits: Record<string, { credited_role: string }>; notes: string[] };

/** The old tool's browser data, split into the six documents. Writes nothing. */
function fromOldTool(blob: Obj, people: Person[]): Plan {
  const notes: string[] = [];
  const byName = new Map(people.map((p) => [p.name.trim().toLowerCase(), p]));
  const docs: Record<string, Obj> = {};
  const credits: Plan["credits"] = {};
  const extras: Obj[] = [];
  const cv: Record<string, Obj> = {};
  for (const person of Array.isArray(blob.roster) ? blob.roster : []) {
    if (!isObj(person)) continue;
    const name = String(person.name ?? "").trim();
    const kind = ["team", "advisor", "host", "none"].includes(String(person.kind)) ? String(person.kind) : "team";
    const match = byName.get(name.toLowerCase());
    const key = match ? match.id : String(person.id ?? name);
    const detail = pick(person, LEGACY_KEYS.person);
    if (Object.keys(detail).length) cv[key] = detail;
    if (match) credits[match.id] = { credited_role: kind === "none" ? "" : String(person.role ?? "").slice(0, 60) };
    else if (name) extras.push({ id: key, name, role: String(person.role ?? ""), kind });
  }
  if (extras.length) notes.push(`${extras.length} people who aren't on the People page were kept as credited-only entries.`);

  const stats = isObj(blob.stats) ? blob.stats : {};
  const override = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, String(v)])
    .filter(([k, v]) => k in OLD_EXAMPLE_STATS && v.trim() && v !== OLD_EXAMPLE_STATS[k]));
  const overview: Obj = {};
  if (Object.keys(override).length) overview.stats_override = override;
  if (isObj(blob.check)) overview.check = Object.fromEntries(Object.entries(blob.check).map(([k, v]) => [k, !!v]));
  if (extras.length) overview.people = extras;
  if (Object.keys(overview).length) docs.overview = overview;
  if ("ann" in blob) docs.announce = pick(blob.ann, LEGACY_KEYS.ann);
  if ("fl" in blob) {
    docs.flavour = pick(blob.fl, LEGACY_KEYS.fl);
    if (isObj(blob.fl) && typeof blob.fl.img === "string") notes.push("The flavour picture wasn't imported. Pick the capsule from the catalogue.");
  }
  if (isObj(blob.car)) {
    const slides = Array.isArray(blob.car.slides) ? blob.car.slides.filter(isObj) : [];
    docs.howto = { ...pick(blob.car, ["theme"]), slides: slides.map((s) => pick(s, ["t", "b"])) };
  }
  if ("li" in blob) docs.linkedin = pick(blob.li, LEGACY_KEYS.li);
  if (Object.keys(cv).length) docs.cv = { people: cv };
  return { docs: Object.fromEntries(Object.entries(docs).filter(([, d]) => Object.keys(d).length)), credits, notes };
}

/** Either the people file ({docs: {tool: doc}}) or the old tool's browser data. */
export function planImport(data: unknown, people: Person[]): Plan {
  let blob = data;
  if (typeof blob === "string") {
    try { blob = JSON.parse(blob); } catch { throw new BadDoc("That isn't valid JSON."); }
  }
  if (!isObj(blob)) throw new BadDoc("Expected the people file, or the object saved under sga-coffee-station-v1.");
  const plan: Plan = isObj(blob.docs)
    ? { docs: blob.docs as Record<string, Obj>, credits: {}, notes: [] }
    : fromOldTool(blob, people);
  Object.entries(plan.docs).forEach(([tool, doc]) => checkDoc(tool, doc));
  return plan;
}

export async function existingTools(tools: string[]) {
  await ensureSchema();
  const rows = (await sql()`SELECT tool FROM hub_marketing_docs`) as { tool: string }[];
  return tools.filter((t) => rows.some((r) => r.tool === t));
}

export async function applyImport(plan: Plan, overwrite: boolean, actor: string) {
  const written: string[] = [], skipped: string[] = [];
  for (const [tool, doc] of Object.entries(plan.docs)) {
    const current = await docRow(tool);
    if (current && !overwrite) { skipped.push(tool); continue; }
    await saveDoc(tool, doc, current?.version ?? 0, actor);
    written.push(tool);
  }
  if (Object.keys(plan.credits).length) {
    const current = await docRow("overview");
    const overview = current?.doc ?? {};
    const credits = isObj(overview.credits) ? (overview.credits as Record<string, Obj>) : {};
    for (const [id, credit] of Object.entries(plan.credits)) {
      if (overwrite || !credits[id]?.credited_role) credits[id] = { ...credits[id], ...credit };
    }
    await saveDoc("overview", { ...overview, credits }, current?.version ?? 0, actor);
  }
  return { written, skipped, notes: plan.notes };
}
