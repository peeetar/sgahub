"use server";

import { revalidatePath } from "next/cache";
import { requireBoard } from "@/lib/auth";
import { addEvent, deleteEvent, moveEvent, updateEvent, type EventInput } from "@/lib/events";

const refresh = () => { revalidatePath("/calendar"); revalidatePath("/"); };

/** Add (id null) or change an event. Returns what's wrong, or null. */
export async function saveEvent(id: string | null, e: EventInput): Promise<string | null> {
  const me = await requireBoard();
  if (id) {
    const err = await updateEvent(id, e);
    if (err) return err;
  } else {
    const r = await addEvent(e, me.username ? `@${me.username}` : me.email);
    if (!r.ok) return r.error;
  }
  refresh();
  return null;
}

/** Drag an event to another day (or move it from the form). */
export async function shiftEvent(id: string, day: string): Promise<string | null> {
  await requireBoard();
  const err = await moveEvent(id, day);
  if (!err) refresh();
  return err;
}

export async function removeEvent(id: string) {
  await requireBoard();
  await deleteEvent(id);
  refresh();
}
