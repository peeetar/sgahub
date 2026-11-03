// Server only. The content calendar: what goes out when, who owns it, and a
// nudge on the morning it's due.
import { ensureSchema, sql } from "./db";
import { TOOLS, team } from "./marketing";
import { notify, appUrl } from "./notify";
import { piGet, type PiAudit, type PiCapsule, type PiLaunch } from "./pi";
import { athensDay } from "./time";

export const STATUSES = ["idea", "draft", "ready", "posted"];
const MILESTONES = [1000, 500, 250, 100];
const RECENT_DAYS = 30;     // how long after a month's anniversary it stays suggested
const FLAVOUR_DAYS = 14;    // how long a newly loaded flavour stays suggested
const PI_MS = 3000;

export type CalendarRow = {
  id: number; date: string; channel: string; title: string; status: string;
  owner: string | null; tool: string | null; notes: string | null; source: string | null;
};
type Fields = Partial<Omit<CalendarRow, "id" | "source">>;

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

/** A month after `day`, clamped to the end of the shorter month. */
function nextMonth(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

/** {fields, errors} for a calendar row. */
export async function clean(data: Record<string, unknown>, partial = false) {
  const out: Fields = {};
  const errors: string[] = [];
  const text = (key: "channel" | "title" | "notes", label: string, limit: number, required: boolean) => {
    if (!(key in data) && (partial || !required)) return;
    const value = typeof data[key] === "string" ? (data[key] as string).trim() : "";
    if (required && !value) errors.push(`${label} is needed.`);
    else if (value.length > limit) errors.push(`${label} is up to ${limit} characters.`);
    out[key] = (value || null) as never;
  };
  if ("date" in data || !partial) {
    if (!isDay(data.date)) errors.push("Date is YYYY-MM-DD.");
    else out.date = data.date;
  }
  text("channel", "Channel", 40, true);
  text("title", "Title", 120, true);
  text("notes", "Notes", 1000, false);
  if ("status" in data || !partial) {
    if (!STATUSES.includes(data.status as string)) errors.push(`Status is one of ${STATUSES.join(", ")}.`);
    else out.status = data.status as string;
  }
  if ("owner" in data) {
    const owner = (data.owner || null) as string | null;
    if (owner !== null && !(await owners()).some((o) => o.email === owner)) errors.push("The owner has to be someone on the People page.");
    out.owner = owner;
  }
  if ("tool" in data) {
    const tool = (data.tool || null) as string | null;
    if (tool !== null && !(TOOLS as readonly string[]).includes(tool)) errors.push(`Tool is one of ${TOOLS.join(", ")}.`);
    out.tool = tool;
  }
  return { fields: out, errors };
}

export async function owners() {
  return (await team()).filter((p) => p.email).map((p) => ({ email: p.email!, name: p.name }));
}

export async function listRows(from: string, to: string) {
  await ensureSchema();
  return (await sql()`SELECT id, date, channel, title, status, owner, tool, notes, source FROM hub_calendar
    WHERE date >= ${from} AND date <= ${to} ORDER BY date, id`) as CalendarRow[];
}

export async function addRow(f: Fields, source: string | null) {
  await ensureSchema();
  const rows = (await sql()`INSERT INTO hub_calendar (date, channel, title, status, owner, tool, notes, source)
    VALUES (${f.date}, ${f.channel}, ${f.title}, ${f.status}, ${f.owner ?? null}, ${f.tool ?? null}, ${f.notes ?? null}, ${source})
    RETURNING id, date, channel, title, status, owner, tool, notes, source`) as CalendarRow[];
  return rows[0];
}

export async function updateRow(id: number, f: Fields) {
  await ensureSchema();
  const q = sql();
  const before = ((await q`SELECT * FROM hub_calendar WHERE id = ${id}`) as CalendarRow[])[0];
  if (!before) return null;
  const row = { ...before, ...f };
  const rows = (await q`UPDATE hub_calendar SET date = ${row.date}, channel = ${row.channel}, title = ${row.title},
    status = ${row.status}, owner = ${row.owner}, tool = ${row.tool}, notes = ${row.notes}
    WHERE id = ${id} RETURNING id, date, channel, title, status, owner, tool, notes, source`) as CalendarRow[];
  return rows[0];
}

export async function deleteRow(id: number) {
  await ensureSchema();
  return ((await sql()`DELETE FROM hub_calendar WHERE id = ${id} RETURNING id`) as unknown[]).length > 0;
}

/** Things worth a post, worked out from what the machine has done. Each has a
 *  stable key; one already turned into a calendar row is left out. With the
 *  kiosk off there are simply no suggestions. */
export async function suggestions(actor: string) {
  await ensureSchema();
  const today = athensDay(new Date());
  const [launch, audit, catalogue, taken] = await Promise.all([
    piGet<PiLaunch>("/launch-numbers", actor, PI_MS),
    piGet<{ entries: PiAudit[] }>(`/audit?action=column_update&from=${shift(today, -FLAVOUR_DAYS)}&limit=100`, actor, PI_MS),
    piGet<{ capsules: PiCapsule[] }>("/capsules", actor, PI_MS),
    sql()`SELECT source FROM hub_calendar WHERE source IS NOT NULL`,
  ]);
  const found: { key: string; date: string; channel: string; title: string; tool: string; why: string }[] = [];

  if (launch.ok) {
    const n = MILESTONES.find((m) => launch.coffees_served >= m);
    if (n) found.push({ key: `milestone-${n}`, date: today, channel: "Social", title: `The ${n}th coffee`, tool: "announce", why: `${n} coffees served` });
    if (launch.days_running > 0) {
      const month = nextMonth(shift(today, 1 - launch.days_running));
      if (shift(month, -14) <= today && today <= shift(month, RECENT_DAYS)) {
        found.push({ key: "one-month", date: month, channel: "LinkedIn", title: "One month of the SGA Coffee Space", tool: "linkedin", why: "One month since the first coffee" });
      }
    }
  }
  if (audit.ok && catalogue.ok) {
    const seen = new Set<string>();
    for (const row of audit.entries) {
      const sku = row.diff?.after?.sku;
      const capsule = catalogue.capsules.find((c) => c.sku === sku);
      if (sku && capsule && !seen.has(sku)) {
        seen.add(sku);
        found.push({ key: `flavour-${sku}`, date: athensDay(row.at), channel: "Social", title: `New flavour: ${capsule.name}`, tool: "flavour", why: `${capsule.name} was loaded into a column` });
      }
    }
  }
  const used = new Set((taken as { source: string }[]).map((r) => r.source));
  return found.filter((s) => !used.has(s.key));
}

/** One ntfy message for each of today's unposted rows, once a day. ntfy can't
 *  ping one person, so the owner is named in the message. */
export async function remind() {
  await ensureSchema();
  const day = athensDay(new Date());
  const q = sql();
  const due = (await q`SELECT * FROM hub_calendar WHERE date = ${day} AND status <> 'posted'
    AND (reminded_on IS NULL OR reminded_on <> ${day}) ORDER BY id`) as CalendarRow[];
  const people = await owners();
  let sent = 0;
  for (const row of due) {
    const who = people.find((p) => p.email === row.owner)?.name || row.owner;
    const delivered = await notify({
      title: `Post today: ${row.title}`,
      message: `${who ? `${who}: ` : ""}“${row.title}” goes out today on ${row.channel} (${row.status}).`,
      tags: ["calendar"], click: appUrl("/marketing/calendar"),
    });
    if (!delivered) continue;
    await q`UPDATE hub_calendar SET reminded_on = ${day} WHERE id = ${row.id}`;
    sent += 1;
  }
  return { due: due.length, sent };
}
