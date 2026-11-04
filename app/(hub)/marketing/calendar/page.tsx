import { requireBoard } from "@/lib/auth";
import MarketingHost from "@/components/marketing/MarketingHost";

export const metadata = { title: "Content calendar · SGA Hub" };

export default async function ContentCalendar() {
  await requireBoard();
  return (
    <main className="hubpage">
      <header className="hubpage__head"><h1>Content calendar</h1></header>
      <MarketingHost view="calendar" />
    </main>
  );
}
