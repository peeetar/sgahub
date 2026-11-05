import Nav from "@/components/hub/Nav";
import { requireBoard } from "@/lib/auth";
import { taskCounts } from "@/lib/tasks";
import { athensDay } from "@/lib/time";

// Every page in this group is board-only.
export const dynamic = "force-dynamic";

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const me = await requireBoard();
  // The badge is a nicety: if the database is down, the pages say so themselves.
  const overdue = await taskCounts(athensDay(Date.now())).then((c) => c.overdue).catch(() => 0);
  return (
    <div className="hub">
      <Nav email={me.username ? `@${me.username}` : me.email} overdue={overdue} />
      <div className="hub__main">{children}</div>
    </div>
  );
}
