import { requireBoard } from "@/lib/auth";
import MarketingHost from "@/components/marketing/MarketingHost";

export const metadata = { title: "Marketing HQ · SGA Hub" };

export default async function MarketingHQ() {
  await requireBoard();
  return (
    <main className="hubpage">
      <header className="hubpage__head"><h1>Marketing HQ</h1></header>
      <MarketingHost view="hq" />
    </main>
  );
}
