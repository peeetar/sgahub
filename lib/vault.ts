// Server only. The vault: every password, key and login the SGA holds, for
// every project, in one place behind Settings.
//
// - The master password is VAULT_PASSWORD, set in Vercel. It is not stored
//   anywhere else and is not a Hub sign-in password.
// - Secret values are encrypted (AES-256-GCM) with a key derived from that
//   password, so a copy of the database, or a look at the Neon dashboard,
//   shows noise. Anyone who can read Vercel's environment variables can open
//   the vault, as they could anyway.
// - Opening it is deliberate: a confirmation, then the master password, then a
//   10-minute window tied to the person's session. Values are fetched one at a
//   time when someone presses Show or Copy, never sent with the page.
// - Every open, reveal, change and failed try is logged (who and what, never the value).
//
// This repo is public, so the starter list below names kinds of secret and
// where they're used, never a value, a username, a host or a person.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { cookieOptions, secretOk, type Session } from "./auth";
import { ensureSchema, getSetting, setSetting, sql } from "./db";

export const VAULT_COOKIE = "hub_vault";
export const OPEN_SECONDS = 600;
export const MIN_MASTER = 12;
export { KINDS } from "./vault-types";
export type { EntryInput, Kind, LogRow, VaultEntry } from "./vault-types";
import { KINDS, type EntryInput, type Kind, type LogRow, type VaultEntry } from "./vault-types";

const master = () => (process.env.VAULT_PASSWORD || "").trim();
const previous = () => (process.env.VAULT_PASSWORD_PREVIOUS || "").trim();

export function vaultState(): "unset" | "short" | "ok" {
  const n = master().length;
  return n === 0 ? "unset" : n < MIN_MASTER ? "short" : "ok";
}

const sha = (s: string) => createHash("sha256").update(s).digest();
export const masterMatches = (given: string) => vaultState() === "ok" && timingSafeEqual(sha(master()), sha(given.trim()));

// --- the open window -----------------------------------------------------------------

const sign = (payload: string) => createHmac("sha256", process.env.HUB_SECRET || "").update("hub-vault-open-v1." + payload).digest("base64url");

/** Open the vault for this person for ten minutes. */
export async function openFor(me: Session) {
  if (!secretOk()) throw new Error("HUB_SECRET must be set (32+ characters)");
  const exp = Date.now() + OPEN_SECONDS * 1000;
  const payload = Buffer.from(JSON.stringify({ e: me.email, x: exp })).toString("base64url");
  (await cookies()).set(VAULT_COOKIE, `${payload}.${sign(payload)}`, { ...cookieOptions(OPEN_SECONDS), sameSite: "strict", path: "/settings/vault" });
}

export async function close() {
  (await cookies()).set(VAULT_COOKIE, "", { ...cookieOptions(0), sameSite: "strict", path: "/settings/vault" });
}

/** When the vault's window ends (ms since epoch) if it's open for this person, else null. */
export async function openUntil(me: Session): Promise<number | null> {
  const raw = (await cookies()).get(VAULT_COOKIE)?.value;
  if (!raw || !secretOk()) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  const want = Buffer.from(sign(payload)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { e, x } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { e: string; x: number };
    return e === me.email && x > Date.now() ? x : null;
  } catch {
    return null;
  }
}

// --- encryption ----------------------------------------------------------------------

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, o: { N: number; r: number; p: number }) => Promise<Buffer>;
const keyCache = new Map<string, Buffer>();

async function salt(): Promise<Buffer> {
  await ensureSchema();
  let s = await getSetting<string | null>("vault_salt", null);
  if (!s) {
    // First use. DO NOTHING, so two requests racing here still agree on one salt.
    await sql()`INSERT INTO hub_settings (key, value) VALUES ('vault_salt', ${JSON.stringify(randomBytes(16).toString("base64"))}::jsonb) ON CONFLICT (key) DO NOTHING`;
    s = await getSetting<string | null>("vault_salt", null);
  }
  return Buffer.from(s!, "base64");
}

async function keyFor(password: string): Promise<Buffer> {
  const s = await salt();
  const id = sha(password + "\0" + s.toString("base64")).toString("base64");
  let k = keyCache.get(id);
  if (!k) {
    k = await scrypt(password, s, 32, { N: 16384, r: 8, p: 1 });
    keyCache.set(id, k);
  }
  return k;
}

/** `v1.iv.tag.ciphertext`. The entry's id is authenticated too, so a value
 *  copied onto another entry's row won't decrypt. */
export function encrypt(plain: string, key: Buffer, id: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(id));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(stored: string, key: Buffer, id: string): string {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("unreadable");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(id));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

// --- the log -------------------------------------------------------------------------

export const who = (me: Session) => (me.username ? `@${me.username}` : me.email);

export async function log(by: string, action: string, detail = "") {
  await ensureSchema();
  await sql()`INSERT INTO hub_vault_log (who, action, detail) VALUES (${by}, ${action}, ${detail.slice(0, 200)})`;
}

export async function recentLog(n = 15): Promise<LogRow[]> {
  await ensureSchema();
  return (await sql()`SELECT at::text AS at, who, action, detail FROM hub_vault_log ORDER BY id DESC LIMIT ${n}`) as LogRow[];
}

// --- entries -------------------------------------------------------------------------

export async function listEntries(): Promise<VaultEntry[]> {
  await ensureSchema();
  return (await sql()`SELECT id, category, label, kind, username, url, notes, (secret_enc IS NOT NULL) AS filled, updated_by, updated_at::text AS updated_at
    FROM hub_vault ORDER BY sort, lower(label)`) as VaultEntry[];
}

function checkEntry(e: EntryInput): { ok: true; v: Required<Pick<EntryInput, "category" | "label" | "username" | "url" | "notes">> & { kind: Kind } } | { ok: false; error: string } {
  const one = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
  const category = one(e.category), label = one(e.label), username = one(e.username), url = one(e.url);
  const notes = String(e.notes ?? "").trim();
  if (!category) return { ok: false, error: "Pick or type a category." };
  if (category.length > 40) return { ok: false, error: "The category is up to 40 characters." };
  if (!label) return { ok: false, error: "Give it a name." };
  if (label.length > 80) return { ok: false, error: "The name is up to 80 characters." };
  if (!(e.kind in KINDS)) return { ok: false, error: "Pick a type." };
  if (username.length > 120) return { ok: false, error: "The username is up to 120 characters." };
  if (url.length > 300) return { ok: false, error: "The link is up to 300 characters." };
  if (notes.length > 1000) return { ok: false, error: "Notes are up to 1000 characters." };
  if (e.secret !== undefined && e.secret.length > 20_000) return { ok: false, error: "That secret is too long to keep here." };
  return { ok: true, v: { category, label, kind: e.kind as Kind, username, url, notes } };
}

export async function saveEntry(id: string | null, e: EntryInput, by: string): Promise<string | null> {
  const c = checkEntry(e);
  if (!c.ok) return c.error;
  await ensureSchema();
  const v = c.v;
  const key = await keyFor(master());
  if (!id) {
    const newId = randomUUID();
    await sql()`INSERT INTO hub_vault (id, category, label, kind, username, url, secret_enc, notes, sort, updated_by)
      VALUES (${newId}, ${v.category}, ${v.label}, ${v.kind}, ${v.username}, ${v.url}, ${e.secret ? encrypt(e.secret, key, newId) : null}, ${v.notes}, ${100_000 + Math.floor(Date.now() / 1000) % 1_000_000}, ${by})`;
    return null;
  }
  const secret = e.clear ? null : e.secret ? encrypt(e.secret, key, id) : undefined;
  await sql()`UPDATE hub_vault SET category = ${v.category}, label = ${v.label}, kind = ${v.kind}, username = ${v.username}, url = ${v.url}, notes = ${v.notes},
    secret_enc = CASE WHEN ${secret === undefined}::boolean THEN secret_enc ELSE ${secret ?? null}::text END, updated_by = ${by}, updated_at = now() WHERE id = ${id}`;
  return null;
}

export async function deleteEntry(id: string) {
  await ensureSchema();
  await sql()`DELETE FROM hub_vault WHERE id = ${id}`;
}

/** One value, decrypted, for the person who pressed Show or Copy. */
export async function revealSecret(id: string): Promise<{ label: string; value: string } | null> {
  await ensureSchema();
  const [row] = (await sql()`SELECT label, secret_enc FROM hub_vault WHERE id = ${id}`) as { label: string; secret_enc: string | null }[];
  if (!row?.secret_enc) return null;
  return { label: row.label, value: decrypt(row.secret_enc, await keyFor(master()), id) };
}

/** How many filled entries can't be read with the current master password, and
 *  re-encrypts any that the previous one (VAULT_PASSWORD_PREVIOUS) can read. */
export async function checkReadable(rotate: boolean): Promise<{ rotated: number; unreadable: number }> {
  await ensureSchema();
  const rows = (await sql()`SELECT id, secret_enc FROM hub_vault WHERE secret_enc IS NOT NULL`) as { id: string; secret_enc: string }[];
  const now = await keyFor(master());
  const old = previous().length >= MIN_MASTER && previous() !== master() ? await keyFor(previous()) : null;
  let rotated = 0, unreadable = 0;
  for (const r of rows) {
    try { decrypt(r.secret_enc, now, r.id); continue; } catch { /* try the old one */ }
    if (old && rotate) {
      try {
        const plain = decrypt(r.secret_enc, old, r.id);
        await sql()`UPDATE hub_vault SET secret_enc = ${encrypt(plain, now, r.id)} WHERE id = ${r.id}`;
        rotated++;
        continue;
      } catch { /* unreadable with both */ }
    }
    unreadable++;
  }
  return { rotated, unreadable };
}

// --- what the SGA has: the starter list ------------------------------------------------

type Seed = [key: string, category: string, label: string, kind: Kind, url: string, note: string];

const SEEDS: Seed[] = [
  ["hub-secret", "SGA Hub", "HUB_SECRET", "key", "", "Signs the Hub's login cookies. Set in Vercel; nobody types it. Changing it signs everyone out."],
  ["hub-password", "SGA Hub", "HUB_PASSWORD (emergency shared password)", "password", "", "Gets the first person in and is the way back if someone is locked out. 8+ characters."],
  ["cron-secret", "SGA Hub", "CRON_SECRET", "key", "", "Lets Vercel's morning jobs run: the calendar reminder and the Notion task sync."],
  ["database-url", "SGA Hub", "DATABASE_URL (Neon database)", "key", "", "Set by the Vercel Neon integration; recoverable from the Vercel dashboard."],
  ["blob-token", "SGA Hub", "BLOB_READ_WRITE_TOKEN (file storage)", "key", "", "Private storage for receipts and meeting recordings. Set by the Vercel Blob integration."],

  ["pos-password", "Merch till", "POS_PASSWORD (the till)", "password", "", "Typed on every merch tablet. Shared with volunteers who sell, so it is separate from the board login."],
  ["tablets", "Merch till", "Merch tablets", "note", "", "Which tablet is held by whom, and any screen passcodes."],

  ["kiosk-token", "Coffee machine", "KIOSK_TOKEN / HUB_TOKEN", "key", "", "The Pi's report to the Hub every minute. The same value in Vercel (KIOSK_TOKEN) and on the Pi (HUB_TOKEN)."],
  ["pi-api-token", "Coffee machine", "PI_API_TOKEN / HUB_API_TOKEN", "key", "", "The Hub's live calls to the Pi. The same value in Vercel and on the Pi."],
  ["pi-ssh", "Coffee machine", "Raspberry Pi login (SSH)", "login", "", "Shell on the kiosk's Pi: the user, its password, and who has an SSH key on it."],
  ["pi-admin", "Coffee machine", "ADMIN_PASSWORD (the Pi's own dashboard)", "password", "", "Break-glass login on the Pi's local dashboard."],
  ["kiosk-dev", "Coffee machine", "DEV_CODE (developer mode on the kiosk screen)", "password", "", "Opens developer mode on the touchscreen."],
  ["deploy-key", "Coffee machine", "GitHub deploy key on the Pi", "key", "", "Lets the Pi pull the release branch from GitHub."],
  ["restic", "Coffee machine", "Backup encryption password (RESTIC_PASSWORD)", "password", "", "Without it nobody can read the kiosk's backups. Keep one per backup target if they differ."],
  ["backup-servers", "Coffee machine", "Backup server logins", "login", "", "Where the encrypted kiosk backups are copied to each day."],
  ["env-copy", "Coffee machine", "Copy of the kiosk's environment file", "note", "", "A full copy of /etc/coffee-kiosk/env, so the Pi can be rebuilt from scratch."],
  ["heartbeats", "Coffee machine", "Monitoring ping URLs (HEARTBEAT_URLS)", "link", "", "The pings that tell healthchecks.io and Uptime Kuma the Pi is alive."],
  ["kiosk-ntfy", "Coffee machine", "Kiosk alert topics (urgent and info)", "key", "", "Anyone who knows a topic can read its alerts. Rotate if one leaks."],
  ["tailscale", "Coffee machine", "Tailscale account", "login", "https://login.tailscale.com", "Reaches the Pi and gives it the public address the Hub calls. Keep at least two admins."],
  ["act-wifi", "Coffee machine", "ACT Wi-Fi device login", "login", "", "How the Pi joins the school network. Ask ACT IT for a device account, and note the contact here."],

  ["instagram", "Social media", "Instagram @act_studentgov", "login", "https://www.instagram.com", "SGA's public account, which also receives top-up requests by DM. Add the recovery email and phone."],
  ["canva", "Social media", "Canva account", "login", "https://www.canva.com", "The SGA's designs. Confirm who holds the account for next year."],

  ["notion-token", "Meetings & Notion", "NOTION_TOKEN (integration secret)", "key", "https://www.notion.so/profile/integrations", "Reads meeting notes and writes task status back. Needs the Read, Update and Insert content permissions."],
  ["notion-workspace", "Meetings & Notion", "Notion workspace admin login", "login", "https://www.notion.so", "Who can add members and integrations."],
  ["gemini", "Meetings & Notion", "GEMINI_API_KEY", "key", "https://aistudio.google.com/apikey", "Transcribes and writes up meeting recordings. Made with the SGA Google account."],
  ["google", "Meetings & Notion", "SGA Google account", "login", "https://accounts.google.com", "Owns the Gemini key."],

  ["ntfy-topic", "Alerts & monitoring", "NTFY_TOPIC (the Hub's alerts)", "key", "", "Everyone on the board subscribes to it. Anyone who knows it can read the alerts."],
  ["ntfy-token", "Alerts & monitoring", "NTFY_TOKEN (if the topic is protected)", "key", "", "Only if the ntfy topic needs a login."],
  ["healthchecks", "Alerts & monitoring", "healthchecks.io login", "login", "https://healthchecks.io", "Warns when the Pi stops reporting."],
  ["uptime-kuma", "Alerts & monitoring", "Uptime Kuma login", "login", "", "A second watcher on the Pi."],

  ["sga-mailbox", "Accounts & recovery", "SGA mailbox", "login", "", "The recovery address for every account in this vault. Add its own recovery options."],
  ["vercel", "Accounts & recovery", "Vercel team", "login", "https://vercel.com", "Hosts the Hub. The SGA mailbox should be an Owner, not a personal login."],
  ["github", "Accounts & recovery", "GitHub (code for the Hub, till and kiosk)", "login", "https://github.com", "Move the repositories to an organisation the SGA mailbox owns."],

  ["wiki", "Legacy (to retire)", "Old SGA wiki (Docmost) admin", "login", "", "Replaced by Notion. Shut it down or hand it over."],
  ["cloudflare", "Legacy (to retire)", "Cloudflare account (the old wiki's tunnel)", "login", "https://dash.cloudflare.com", "Confirm nothing uses it any more, then close it."],
];

export const STARTER_COUNT = SEEDS.length;

/** Add the starter entries that aren't in the vault yet, with no value filled in. */
export async function addStarter(by: string): Promise<number> {
  await ensureSchema();
  const q = sql();
  const rows = await q.transaction(SEEDS.map(([key, category, label, kind, url, note], i) => q`
    INSERT INTO hub_vault (id, category, label, kind, url, notes, sort, seed_key, updated_by)
    VALUES (${randomUUID()}, ${category}, ${label}, ${kind}, ${url}, ${note}, ${(i + 1) * 10}, ${key}, ${by})
    ON CONFLICT (seed_key) DO NOTHING RETURNING id`)) as { id: string }[][];
  await setSetting("vault_seeded", true);
  return rows.filter((r) => r.length).length;
}

export const starterAdded = () => getSetting<boolean>("vault_seeded", false);
