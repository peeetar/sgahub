// The task board's shapes and labels, with nothing server-only in them, so the
// Tasks page (a client component) can share them with lib/tasks.ts.

export type Status = "open" | "in_progress" | "blocked" | "done" | "dismissed";
export const STATUS_LABEL: Record<Status, string> = {
  open: "To do", in_progress: "In progress", blocked: "Blocked", done: "Done", dismissed: "Hidden",
};
export const ACTIVE: Status[] = ["open", "in_progress", "blocked"];

export type Task = {
  id: string; title: string; notes: string;
  owner_id: string | null; owner_name: string;
  due_on: string | null; status: Status;
  source: "manual" | "notion"; notion_url: string | null; meeting_title: string | null; notion_error: string | null;
  completed_at: string | null; completed_by: string | null;
};

export type TaskInput = {
  title: string; notes: string; owner_id: string | null; owner_name: string; due_on: string | null; status: Status;
};

export type SyncInfo = { at: string; imported: number; closed: number; pages: string[]; error?: string } | null;
