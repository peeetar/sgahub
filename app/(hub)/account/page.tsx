import { requireBoard } from "@/lib/auth";
import AccountForm from "./AccountForm";

export const metadata = { title: "Account · SGA Hub" };

export default async function Account() {
  const me = await requireBoard();
  return (
    <main className="hubpage">
      <header className="hubpage__head"><h1>Account</h1></header>
      <p className="muted">Signed in as <strong>{me.username ? `@${me.username}` : me.email}</strong>.</p>
      {me.username
        ? <AccountForm />
        : <p className="muted">You signed in with the emergency shared password, so there is no personal password to change.</p>}
    </main>
  );
}
