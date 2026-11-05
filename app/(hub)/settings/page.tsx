import Link from "next/link";
import { DbDown, Panel } from "@/components/hub/bits";
import { requireBoard } from "@/lib/auth";
import { currentTerm } from "@/lib/db";
import { piConfigured, piGet } from "@/lib/pi";
import { setupChecks } from "./checks";
import { ScheduleImport, TermForm, TestAlert } from "./SettingsForms";

export const metadata = { title: "Settings · SGA Hub" };

export default async function Settings() {
  const me = await requireBoard();
  const checks = setupChecks();
  const pi = piConfigured() ? await piGet<{ role: string }>("/me", me.email) : null;
  let term: string | null = null;
  let dbErr: unknown = null;
  try { term = await currentTerm(); } catch (err) { dbErr = err; }
  const topic = process.env.NTFY_TOPIC;
  const ntfyBase = (process.env.NTFY_URL || "https://ntfy.sh").replace(/\/$/, "");

  return (
    <main className="hubpage">
      <header className="hubpage__head"><h1>Settings</h1></header>
      {dbErr !== null && <DbDown err={dbErr} />}

      <Panel title="Setup">
        <p className="muted small">Set these as environment variables in the Vercel project, then redeploy. Only whether each is set is shown here; values never leave Vercel.</p>
        <ul className="checks">
          {checks.map((c) => (
            <li key={c.key} className={c.ok ? "is-ok" : c.required ? "is-bad" : "is-off"}>
              <span className="checks__mark" aria-hidden="true">{c.ok ? "✓" : c.required ? "!" : "–"}</span>
              <div><strong>{c.label}</strong> <code>{c.key}</code>{!c.required && <span className="muted small"> optional</span>}
                <p className="muted small">{c.help}</p></div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Vault">
        <p>Every password, key and login the SGA holds, for the Hub, the coffee machine, social media and the rest, in one place.</p>
        <p className="muted small">Opening it asks for the vault password (<code>VAULT_PASSWORD</code> in Vercel). Saved values are encrypted, shown only when someone presses Show or Copy, and each look is logged with a name.</p>
        <p><Link href="/settings/vault" className="btn btn--primary">Open the vault</Link></p>
      </Panel>

      <Panel title="Event schedule">
        <p className="muted small">Paste a list of dates and the calendar fills in. You can still add, edit and drag events on the Calendar afterwards.</p>
        <ScheduleImport />
      </Panel>

      {pi && (
        <Panel title="Coffee kiosk connection">
          {pi.ok ? <p><span className="dot-status dot-status--ok">Connected.</span> The hub can reach the Pi and the Pi accepts its token.</p>
            : <p><span className="dot-status dot-status--bad">Not connected.</span> {pi.message}</p>}
        </Panel>
      )}

      <Panel title="Alerts (ntfy)">
        {topic ? (
          <>
            <p>Everyone on the board: install the ntfy app and subscribe to this topic{process.env.NTFY_URL ? ` on ${ntfyBase}` : ""}:</p>
            <p><code className="code-big">{topic}</code></p>
            <p className="muted small">Or open <a href={`${ntfyBase}/${encodeURIComponent(topic)}`} target="_blank" rel="noreferrer">{ntfyBase.replace(/^https?:\/\//, "")}/{topic}</a> on the phone. Alerts so far: merch running low or sold out. Kiosk alerts join when the kiosk is connected.</p>
            <TestAlert />
          </>
        ) : <p className="muted">Set NTFY_TOPIC first.</p>}
      </Panel>

      {term && (
        <Panel title="Handover">
          <p>Current term: <strong>{term}</strong>. Only people listed for this term can get a sign-in link.</p>
          <p className="muted small">When the new board takes over: add them on People under the new term, then switch the term here. Last year&apos;s board stays on record but can no longer sign in. Rotate the till password and the fallback password at the same time.</p>
          <TermForm current={term} />
        </Panel>
      )}
    </main>
  );
}
