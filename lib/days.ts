// Calendar-day arithmetic on YYYY-MM-DD strings, with no time zones in it: a
// day is just a day. Safe to import from the browser and the server alike.

const at = (day: string) => new Date(`${day}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (day: string, n: number) => iso(new Date(at(day).getTime() + n * 864e5));
export const diffDays = (a: string, b: string) => Math.round((at(a).getTime() - at(b).getTime()) / 864e5);

/** 0 for Monday … 6 for Sunday: Greek weeks start on Monday. */
export const weekday = (day: string) => (at(day).getUTCDay() + 6) % 7;
export const startOfWeek = (day: string) => addDays(day, -weekday(day));

export const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`;
export const lastOfMonth = (day: string) => iso(new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7), 0, 12)));
export const addMonths = (day: string, n: number) => {
  const d = at(firstOfMonth(day));
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, 12)));
};

export const fmtDay = (day: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...o }).format(at(day));

/** Every day of the weeks that cover the month of `day`, Monday first. */
export function monthGrid(day: string): string[] {
  const from = startOfWeek(firstOfMonth(day));
  const to = addDays(startOfWeek(lastOfMonth(day)), 6);
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "Today", "Tomorrow", "In 4 days", "Yesterday", "3 days ago". */
export function relative(day: string, today: string): string {
  const n = diffDays(day, today);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}
