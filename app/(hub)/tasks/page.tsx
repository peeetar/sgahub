import { DbDown } from "@/components/hub/bits";
import { requireBoard } from "@/lib/auth";
import { ensureSchema } from "@/lib/db";
import { notionConfigured } from "@/lib/notion";
import { getSyncInfo, listTasks, people, personFor } from "@/lib/tasks";
import { athensDay } from "@/lib/time";
import TasksBoard from "./TasksBoard";

export const metadata = { title: "Tasks · SGA Hub" };

export default async function TasksPage() {
  const me = await requireBoard();
  try {
    await ensureSchema();
    const [tasks, team, sync, meId] = await Promise.all([listTasks(), people(), getSyncInfo(), personFor(me)]);
    return <TasksBoard tasks={tasks} people={team} meId={meId} today={athensDay(Date.now())} sync={sync} notion={notionConfigured()} />;
  } catch (err) {
    return <main className="hubpage"><header className="hubpage__head"><h1>Tasks</h1></header><DbDown err={err} /></main>;
  }
}
