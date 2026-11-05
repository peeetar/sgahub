// The calendar's shapes and labels, with nothing server-only in them, so the
// Calendar page (a client component) can share them with lib/events.ts.

export const CATEGORIES = {
  event: "Event",
  meeting: "Meeting",
  deadline: "Deadline",
  coffee: "Coffee Space",
  merch: "Merch",
  marketing: "Marketing",
  school: "School",
} as const;
export type Category = keyof typeof CATEGORIES;
export const isCategory = (c: unknown): c is Category => typeof c === "string" && c in CATEGORIES;

export type EventRow = {
  id: string; title: string; starts_on: string; ends_on: string | null;
  start_time: string | null; end_time: string | null;
  location: string; category: Category; notes: string; source: string;
};

export type EventInput = {
  title: string; starts_on: string; ends_on?: string | null;
  start_time?: string | null; end_time?: string | null;
  location?: string; category?: string; notes?: string;
};
