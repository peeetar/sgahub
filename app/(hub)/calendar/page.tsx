import { DbDown } from "@/components/hub/bits";
import { ensureSchema } from "@/lib/db";
import { listEvents } from "@/lib/events";
import { athensDay } from "@/lib/time";
import CalendarBoard from "./CalendarBoard";

export const metadata = { title: "Calendar · SGA Hub" };

const shift = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

export default async function CalendarPage() {
  try {
    await ensureSchema();
    const today = athensDay(Date.now());
    // Wide enough to page through the whole academic year without asking the
    // server again; a year of SGA events is a few hundred rows at most.
    const events = await listEvents(shift(today, -200), shift(today, 540));
    return <CalendarBoard events={events} today={today} />;
  } catch (err) {
    return <main className="hubpage"><header className="hubpage__head"><h1>Calendar</h1></header><DbDown err={err} /></main>;
  }
}
