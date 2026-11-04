import { Panel } from "@/components/hub/bits";
import { requireBoard } from "@/lib/auth";
import { piGet, type PiBanner, type PiUpkeepTask } from "@/lib/pi";
import { PiDown } from "../PiDown";
import { AddTask, BannerForm, TaskActions } from "./UpkeepForms";

export const metadata = { title: "Kiosk upkeep · SGA Hub" };

const tone = (state: PiUpkeepTask["state"]) => (state === "due" ? "pill--bad" : state === "soon" ? "pill--warn" : "");
const word = { due: "due", soon: "soon", ok: "fine" };
const words: Record<PiBanner["state"], string> = { off: "No banner", showing: "Showing now", scheduled: "Scheduled", expired: "Ended" };

export default async function Upkeep() {
  const me = await requireBoard();
  const [tasks, banner] = await Promise.all([
    piGet<{ tasks: PiUpkeepTask[] }>("/upkeep", me.email),
    piGet<PiBanner>("/banner", me.email),
  ]);
  return (
    <main className="hubpage">
      <header className="hubpage__head"><h1>Kiosk upkeep</h1></header>
      {!tasks.ok ? <PiDown err={tasks} /> : (
        <Panel title="Recurring jobs">
          <p className="muted small">Counted in coffees, days, or whichever comes first. When one is due it shows on the kiosk&apos;s status.</p>
          {tasks.tasks.length === 0 ? <p className="muted">Nothing yet. Add descaling, emptying the used capsules, wiping the chute, checking the water.</p> : (
            <table className="tbl"><tbody>
              {tasks.tasks.map((t) => (
                <tr key={t.id}>
                  <td><span className={"pill " + tone(t.state)}>{word[t.state]}</span></td>
                  <td><strong>{t.name}</strong><div className="muted small">{t.summary}</div></td>
                  <td><TaskActions id={t.id} name={t.name} /></td>
                </tr>
              ))}
            </tbody></table>
          )}
          <AddTask />
        </Panel>
      )}
      {banner.ok && (
        <Panel title="Attract-screen banner">
          <p className="muted small">{words[banner.state]}. A short message on the kiosk&apos;s first screen. Blank times mean from now, until you clear it. Athens time.</p>
          <BannerForm text={banner.text} from={banner.from_local || ""} to={banner.to_local || ""} />
        </Panel>
      )}
    </main>
  );
}
