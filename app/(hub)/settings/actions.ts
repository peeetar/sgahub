"use server";

import { revalidatePath } from "next/cache";
import { requireBoard } from "@/lib/auth";
import { setSetting } from "@/lib/db";
import { CATEGORIES, importSchedule, parseSchedule } from "@/lib/events";
import { appUrl, notify } from "@/lib/notify";

export async function sendTestAlert(): Promise<string> {
  const me = await requireBoard();
  const ok = await notify({ title: "SGA Hub test", message: `Test alert sent by ${me.email}. If you can read this, alerts reach you.`, tags: ["white_check_mark"], click: appUrl("/settings") });
  return ok ? "Sent. Check your phone." : "Couldn't send. Is NTFY_TOPIC set?";
}

/** The yearly handover: the new board's term becomes current. Last year's
 *  people stay on record under their own term but can no longer sign in. */
export async function startTerm(term: string): Promise<string | null> {
  await requireBoard();
  if (!/^\d{4}-\d{2}$/.test(term) || (Number(term.slice(0, 4)) + 1) % 100 !== Number(term.slice(5))) return "Write it like 2027-28.";
  await setSetting("term", term);
  revalidatePath("/", "layout");
  return null;
}

export type SchedulePreview = {
  errors: string[];
  events: { day: string; until: string | null; time: string; title: string; place: string; type: string }[];
};

/** What pasting this text would add, without adding it. */
export async function previewSchedule(text: string): Promise<SchedulePreview> {
  await requireBoard();
  const { events, errors } = parseSchedule(String(text ?? "").slice(0, 50_000));
  return {
    errors,
    events: events.slice(0, 200).map((e) => ({ day: e.starts_on, until: e.ends_on, time: e.start_time ? e.start_time + (e.end_time ? `–${e.end_time}` : "") : "All day",
      title: e.title, place: e.location, type: CATEGORIES[e.category] })),
  };
}

/** Put a pasted schedule on the calendar. All or nothing; pasting it twice adds nothing new. */
export async function addSchedule(text: string): Promise<{ added: number; existing: number; errors: string[] }> {
  const me = await requireBoard();
  const r = await importSchedule(String(text ?? "").slice(0, 50_000), me.username ? `@${me.username}` : me.email);
  if (!r.errors.length) { revalidatePath("/calendar"); revalidatePath("/"); }
  return r;
}
