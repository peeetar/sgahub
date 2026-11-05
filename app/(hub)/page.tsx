import Link from "next/link";
import { DbDown, Panel, Stat, ago } from "@/components/hub/bits";
import MiniMonth from "@/components/hub/MiniMonth";
import { live } from "@/lib/calc";
import { currentTerm, ensureSchema, sql } from "@/lib/db";
import { addDays, fmtDay, lastOfMonth, relative } from "@/lib/days";
import { CATEGORIES } from "@/lib/event-types";
import { listEvents, upcomingEvents } from "@/lib/events";
import { loadEntries, periodRange, summarise } from "@/lib/finance";
import { loadKiosk } from "@/lib/kiosk";
import { lowStock, loadMerch, variantName } from "@/lib/merch";
import { ntfyConfigured } from "@/lib/notify";
import { dueTasks, taskCounts } from "@/lib/tasks";
import { athensDay, lastDays, termStart } from "@/lib/time";
import { euros } from "@/lib/types";

import { setupChecks } from "./settings/checks";

export const metadata = { title: "Overview · SGA Hub" };

export default async function Overview() {
  let body: React.ReactNode;
  try {
    await ensureSchema();
    const today = athensDay(Date.now());
    const [data, term, kiosk] = await Promise.all([loadMerch(), currentTerm(), loadKiosk()]);
    // The newer sections load on their own, so one failing doesn't blank the page.
    const [counts, overdue, soon, monthEvents, next, entries] = await Promise.all([
      taskCounts(today).catch(() => null),
      dueTasks(today, "overdue", 6).catch(() => null),
      dueTasks(today, "soon", 6).catch(() => null),
      listEvents(addDays(today.slice(0, 7) + "-01", -7), addDays(lastOfMonth(today), 7)).catch(() => null),
      upcomingEvents(today, 6).catch(() => null),
      loadEntries(...periodRange(term, "year")).catch(() => null),
    ]);
    const money = entries ? summarise(entries) : null;
    const [{ filled }] = (await sql()`SELECT count(*)::int AS filled FROM hub_people WHERE term = ${term}`) as { filled: number }[];
    const [{ seats }] = (await sql()`SELECT sum(seats)::int AS seats FROM hub_roles`) as { seats: number }[];

    const sales = live(data.sales);
    const week = new Set(lastDays(7));
    const from = termStart(term);
    const sum = (pred: (day: string) => boolean) => sales.filter((s) => pred(athensDay(s.sold_at))).reduce((n, s) => n + s.total_cents, 0);
    const openShifts = data.shifts.filter((s) => !s.closed_at);
    const low = lowStock(data);
    const missing = setupChecks().filter((c) => !c.ok && c.required);
    const owedCents = money ? money.owed.reduce((n, o) => n + o.cents, 0) : 0;

    body = (
      <>
        {missing.length > 0 && (
          <div className="notice notice--warn">
            <strong>Setup isn&apos;t finished:</strong> {missing.map((c) => c.label).join(", ")}. See <Link href="/settings">Settings</Link>.
          </div>
        )}
        <div className="stats">
          <Stat label="Overdue tasks" value={counts ? counts.overdue : "–"} sub={counts ? `${counts.open} open in all` : "couldn't load"} href="/tasks" />
          <Stat label="Due in 7 days" value={counts ? counts.week : "–"} href="/tasks" />
          <Stat label={`Net this term (${term})`} value={money ? euros(money.net, true) : "–"}
            sub={money ? `${euros(money.income, true)} in · ${euros(money.expense, true)} out` : "couldn't load"} href="/finance" />
          <Stat label="Till today" value={euros(sum((d) => d === today), true)}
            sub={openShifts.length ? `${openShifts.length} cash box${openShifts.length === 1 ? "" : "es"} open` : "no cash box open"} href="/merch" />
        </div>

        <div className="cols">
          <Panel title="Tasks" action={<Link className="linkbtn" href="/tasks">All tasks</Link>}>
            {!overdue || !soon ? <p className="muted">Couldn&apos;t load tasks.</p>
              : overdue.length === 0 && soon.length === 0 ? <p className="muted">Nothing overdue and nothing due this week. 🎉</p> : (
                <>
                  {overdue.length > 0 && <p className="lbl lbl--bad">Overdue{counts && counts.overdue > overdue.length ? ` (${counts.overdue})` : ""}</p>}
                  <ul className="list">
                    {overdue.map((t) => (
                      <li key={t.id}><span><Link href="/tasks">{t.title}</Link>{t.owner_label && <span className="muted small"> · {t.owner_label}</span>}</span>
                        <span className="pill pill--bad">{relative(t.due_on!, today)}</span></li>
                    ))}
                  </ul>
                  {soon.length > 0 && <p className="lbl">Coming up</p>}
                  <ul className="list">
                    {soon.map((t) => (
                      <li key={t.id}><span><Link href="/tasks">{t.title}</Link>{t.owner_label && <span className="muted small"> · {t.owner_label}</span>}</span>
                        <span className="pill">{relative(t.due_on!, today)}</span></li>
                    ))}
                  </ul>
                </>
              )}
          </Panel>

          <Panel title="Calendar" action={<Link className="linkbtn" href="/calendar">Open calendar</Link>}>
            <MiniMonth today={today} events={monthEvents ?? []} />
            {next === null ? <p className="muted">Couldn&apos;t load events.</p> : next.length === 0 ? <p className="muted small">Nothing coming up. Add events on the calendar, or paste a schedule in Settings.</p> : (
              <ul className="list list--tight">
                {next.map((e) => (
                  <li key={e.id}>
                    <span><span className={"dot dot--" + e.category} title={CATEGORIES[e.category]} /> <Link href="/calendar">{e.title}</Link>
                      {e.start_time && <span className="muted small"> · {e.start_time}</span>}</span>
                    <span className="muted small">{e.starts_on <= today ? "Now" : `${fmtDay(e.starts_on, { weekday: "short", day: "numeric", month: "short" })}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Finance" action={<Link className="linkbtn" href="/finance">Finance</Link>}>
            {!money ? <p className="muted">Couldn&apos;t load the ledger.</p> : (
              <>
                <dl className="kv">
                  <div><dt>Money in</dt><dd>{euros(money.income, true)}</dd></div>
                  <div><dt>Spent</dt><dd>{euros(money.expense, true)}</dd></div>
                  <div><dt>Net</dt><dd><strong>{euros(money.net, true)}</strong></dd></div>
                </dl>
                {owedCents > 0
                  ? <p className="small"><span className="pill pill--warn">{euros(owedCents, true)} to pay back</span> to {money.owed.map((o) => o.who).join(", ")}</p>
                  : <p className="muted small">No one is waiting to be paid back.</p>}
                {money.byExpense[0] && <p className="muted small">Biggest cost: {money.byExpense[0].label}, {euros(money.byExpense[0].cents, true)}.</p>}
              </>
            )}
          </Panel>
        </div>

        <div className="cols">
          <Panel title="Running low" action={<Link className="linkbtn" href="/merch">All stock</Link>}>
            {low.length === 0 ? <p className="muted">Nothing is low. 🎉</p> : (
              <ul className="list">
                {low.slice(0, 8).map((r) => (
                  <li key={r.key}><span>{variantName(r.product, r.color, r.size)}</span>
                    <span className={"pill " + (r.left <= 0 ? "pill--bad" : "pill--warn")}>{r.left <= 0 ? "sold out" : `${r.left} left`}</span></li>
                ))}
                {low.length > 8 && <li className="muted">…and {low.length - 8} more</li>}
              </ul>
            )}
          </Panel>

          <Panel title="Coffee kiosk" action={<Link className="linkbtn" href="/kiosk">Kiosk</Link>}>
            {!kiosk.report ? <p className="muted">Not connected yet. Once the Pi reports in, its status shows here.</p> : (
              <>
                <p><span className={"dot-status dot-status--" + (!kiosk.online ? "off" : kiosk.report.mode === "in_service" ? "ok" : kiosk.report.mode === "maintenance" ? "warn" : "bad")}>
                  {!kiosk.online ? "Offline" : kiosk.report.mode === "in_service" ? "In service" : kiosk.report.mode === "maintenance" ? "Maintenance" : "Out of service"}</span>
                  <span className="muted small"> · {kiosk.online ? "reported" : "last seen"} {ago(kiosk.receivedAt)}</span></p>
                <p><strong>{kiosk.report.today.vends}</strong> coffees today · <strong>{kiosk.report.columns.reduce((n, c) => n + Math.max(0, c.stock), 0)}</strong> capsules left
                  {kiosk.report.columns.some((c) => c.enabled && c.sku && c.stock <= 0) && <span className="pill pill--bad"> a column is empty</span>}</p>
              </>
            )}
          </Panel>

          <Panel title="Board" action={<Link className="linkbtn" href="/people">People</Link>}>
            <p><strong>{filled}</strong> of {seats} seats filled for {term}.</p>
            <p className="muted small">Till, last 7 days: {euros(sum((d) => week.has(d)), true)}. Since 1 Aug: {euros(sum((d) => d >= from), true)}.</p>
            <p className="muted small">Alerts go to ntfy{ntfyConfigured() ? "" : " (not set up yet)"}. Everyone on the board should subscribe to the topic in Settings.</p>
          </Panel>
        </div>
      </>
    );
  } catch (err) {
    body = <DbDown err={err} />;
  }
  return (
    <main className="hubpage">
      <header className="hubpage__head"><h1>Overview</h1></header>
      {body}
    </main>
  );
}
