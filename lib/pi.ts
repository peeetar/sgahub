// Server only. The hub's live line to the kiosk's Pi.
//
// lib/kiosk.ts is the Pi calling us once a minute with a summary. This is us
// calling the Pi, for what has to be current and what only the Pi may do:
// balances, top-ups, PIN resets, stock, alerts. It goes over the Pi's public
// route (Tailscale Funnel) with a token only this server holds; browsers never
// talk to the Pi. The Pi keeps its own list of what that token can reach
// (services/hub_api.py in sga-coffee-kiosk).
//
// Writes are never retried here. A timeout doesn't mean a write failed, and
// the money is real: the top-up form resends with the same request id instead,
// and the Sell page's sales carry their own ids, so the Pi counts each once.

const TIMEOUT_MS = 8000;

export type PiFailure = {
  ok: false;
  /** unset: not configured. offline: no answer. refused: the Pi said no. */
  kind: "unset" | "offline" | "refused";
  status?: number;
  message: string;
};
export type PiResult<T> = ({ ok: true } & T) | PiFailure;

export function piConfigured(): boolean {
  return !!process.env.PI_API_URL && (process.env.PI_API_TOKEN || "").length >= 32;
}

async function call<T>(method: string, path: string, actor: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<PiResult<T>> {
  if (!piConfigured()) return { ok: false, kind: "unset", message: "PI_API_URL and PI_API_TOKEN aren't set." };
  const url = process.env.PI_API_URL!.replace(/\/+$/, "") + "/admin/api" + path;
  let res: Response;
  try {
    res = await fetch(url, {
      method, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${process.env.PI_API_TOKEN}`, "X-Hub-Actor": actor,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, kind: "offline", message: "The kiosk didn't answer." };
  }
  const data = (await res.json().catch(() => null)) as ({ ok?: boolean; message?: string } & T) | null;
  if (res.ok && data?.ok) return { ...data, ok: true };
  if (res.status === 401) return { ok: false, kind: "refused", status: 401, message: "The kiosk refused the hub's token. PI_API_TOKEN here must equal HUB_API_TOKEN on the Pi." };
  return { ok: false, kind: res.status >= 500 ? "offline" : "refused", status: res.status, message: data?.message || `The kiosk answered ${res.status}.` };
}

export const piGet = <T>(path: string, actor: string) => call<T>("GET", path, actor);
export const piPost = <T = object>(path: string, actor: string, body: unknown = {}, timeoutMs?: number) => call<T>("POST", path, actor, body, timeoutMs);
export const piPut = <T = object>(path: string, actor: string, body: unknown) => call<T>("PUT", path, actor, body);
export const piDelete = <T = object>(path: string, actor: string) => call<T>("DELETE", path, actor);

// --- what the Pi sends back ---------------------------------------------------

export type PiColumn = {
  column_index: number; sku: string | null; name?: string | null; bg_color?: string | null; stock: number; capacity: number;
  low_threshold: number; enabled: number; jam_count: number; consecutive_jams: number;
};
export type PiStats = { coffees: number; free_coffees: number; topups: number; new_students: number; cash_cents: number };
export type PiAlert = {
  id: number; code: string; priority: string; state: string; title: string; message?: string | null; detail?: string | null;
  first_at: string; last_at: string; count?: number; acked_by?: string | null;
};
export type PiOverview = {
  status: { state: "in_service" | "maintenance" | "out_of_service"; reason: string | null; since: string | null; maintenance: { on: boolean; by: string | null; note: string | null } };
  columns: PiColumn[];
  today: { today: PiStats; last_week: PiStats };
  alerts: PiAlert[];
  todos: { level: string; text: string }[];
  chips: { internet_ok: boolean | null; disk_free_mb: number; cpu_temp: number | null; last_backup: string | null; version: string; dispenser: { ok: boolean | null; detail: string | null } };
};
export type PiStudent = {
  student_id: string; kind: "student" | "staff"; credits: number; has_pin: boolean; locked_for: number; failed_pins: number;
  created_at: string; last_seen_at: string | null;
};
export type PiTimelineItem = { id: number; at: string; kind: string; reason?: string | null; amount: number; balance: number; cash_cents?: number | null; actor?: string | null; state?: string | null; sku?: string | null };
export type PiStudentDetail = { student: PiStudent; timeline: PiTimelineItem[]; signup: { credits?: number } | null; history_matches: boolean };
export type PiUpkeepTask = { id: number; name: string; every_coffees: number | null; every_days: number | null; state: "due" | "soon" | "ok"; summary: string };
export type PiBanner = { text: string; state: "off" | "showing" | "scheduled" | "expired"; from_local: string | null; to_local: string | null };
export type PiConfig = { bundles: { cents: number; coffees: number }[]; student_id_length: number; column_capacity: number };
