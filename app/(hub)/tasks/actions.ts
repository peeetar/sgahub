"use server";

import { revalidatePath } from "next/cache";
import { requireBoard, type Session } from "@/lib/auth";
import type { Status, TaskInput } from "@/lib/task-types";
import { removeTask, retryWriteBack, saveTask, setTaskStatus, syncNotion } from "@/lib/tasks";

const who = (me: Session) => (me.username ? `@${me.username}` : me.email);
const refresh = () => { revalidatePath("/tasks"); revalidatePath("/"); };

/** Add (id null) or change a task. `warning` means it changed here but couldn't be written to Notion. */
export async function saveTaskAction(id: string | null, input: TaskInput): Promise<{ error: string | null; warning: string | null }> {
  const me = await requireBoard();
  const r = await saveTask(id, input, who(me));
  if (!r.error) refresh();
  return r;
}

export async function changeStatus(id: string, status: Status): Promise<{ warning: string | null }> {
  const me = await requireBoard();
  const r = await setTaskStatus(id, status, who(me));
  refresh();
  return r;
}

export async function deleteTask(id: string) {
  await requireBoard();
  await removeTask(id);
  refresh();
}

/** Try again to write a task's status into the meeting notes. */
export async function retryNotion(id: string): Promise<string | null> {
  await requireBoard();
  const r = await retryWriteBack(id);
  refresh();
  return r;
}

export async function syncTasks(scan: number): Promise<{ ok: true; imported: number; closed: number; pages: string[] } | { ok: false; error: string }> {
  await requireBoard();
  try {
    const r = await syncNotion(Math.max(1, Math.min(10, Math.round(scan) || 3)));
    refresh();
    return { ok: true, ...r };
  } catch (err) {
    refresh();
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
