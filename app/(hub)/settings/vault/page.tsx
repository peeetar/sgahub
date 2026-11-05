import Link from "next/link";
import { DbDown } from "@/components/hub/bits";
import { requireBoard } from "@/lib/auth";
import * as vault from "@/lib/vault";
import VaultBoard from "./VaultBoard";
import VaultGate from "./VaultGate";

export const metadata = { title: "Vault · SGA Hub" };

export default async function VaultPage() {
  const me = await requireBoard();
  const state = vault.vaultState();
  const until = state === "ok" ? await vault.openUntil(me) : null;

  let body: React.ReactNode;
  if (state !== "ok") {
    body = (
      <div className="notice notice--warn">
        <strong>{state === "unset" ? "The vault has no master password yet." : "The vault password is too short."}</strong>{" "}
        In Vercel, add the environment variable <code>VAULT_PASSWORD</code> ({vault.MIN_MASTER}+ characters, not the Hub or till password), then redeploy.
        It is typed to open this page and it also protects what is stored, so keep it in your own password manager as well.
      </div>
    );
  } else if (!until) {
    body = <VaultGate />;
  } else {
    try {
      const [entries, log, health] = await Promise.all([vault.listEntries(), vault.recentLog(15), vault.checkReadable(false)]);
      body = (
        <VaultBoard entries={entries} log={log} until={until} unreadable={health.unreadable}
          canRotate={!!(process.env.VAULT_PASSWORD_PREVIOUS || "").trim()} />
      );
    } catch (err) {
      body = <DbDown err={err} />;
    }
  }

  return (
    <main className="hubpage">
      <header className="hubpage__head">
        <h1>Vault</h1>
        <Link href="/settings" className="muted small">← Settings</Link>
      </header>
      {body}
    </main>
  );
}
