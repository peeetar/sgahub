import Link from "next/link";
import { addDays, fmtDay, monthGrid, firstOfMonth } from "@/lib/days";
import type { EventRow } from "@/lib/event-types";

/** A small month for the Overview: today ringed, days with something on dotted.
 *  Server-rendered; every day links to the full calendar. */
export default function MiniMonth({ today, events }: { today: string; events: EventRow[] }) {
  const busy = new Set<string>();
  for (const e of events) {
    for (let d = e.starts_on; d <= (e.ends_on ?? e.starts_on); d = addDays(d, 1)) busy.add(d);
  }
  const month = today.slice(0, 7);
  return (
    <div className="mini">
      <p className="mini__title">{fmtDay(firstOfMonth(today), { month: "long", year: "numeric" })}</p>
      <div className="mini__grid" role="grid" aria-label="This month">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="mini__dow" aria-hidden="true">{d}</span>)}
        {monthGrid(today).map((d) => (
          <Link key={d} href="/calendar" aria-label={fmtDay(d, { weekday: "long", day: "numeric", month: "long" }) + (busy.has(d) ? ", has events" : "")}
            className={"mini__day" + (d === today ? " is-today" : "") + (d.slice(0, 7) !== month ? " is-faded" : "") + (busy.has(d) ? " has-ev" : "")}>
            {+d.slice(8)}
          </Link>
        ))}
      </div>
    </div>
  );
}
