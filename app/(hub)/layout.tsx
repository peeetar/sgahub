import Nav from "@/components/hub/Nav";
import { requireBoard } from "@/lib/auth";

// Every page in this group is board-only.
export const dynamic = "force-dynamic";

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const me = await requireBoard();
  return (
    <div className="hub">
      <Nav email={me.username ? `@${me.username}` : me.email} />
      <div className="hub__main">{children}</div>
    </div>
  );
}
