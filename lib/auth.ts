// Server only. Board sign-in for the hub.
//
// Everyone on the board has the same access. Who counts as "the board" is the
// People page: anyone listed for the current term who has been given a
// username and password there. No email is sent, so no domain is needed.
// HUB_PASSWORD, if set, is an emergency shared password, and is also how the
// very first person gets in before anyone has a login.
//
// The till (/pos) has its own password and session (lib/session.ts), because
// volunteers who aren't on the board sell merch too.
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentTerm, ensureSchema, sql } from "./db";

export const HUB_COOKIE = "hub_session";
const SESSION_DAYS = 30;

/** False when HUB_SECRET is missing or too short to sign sessions safely. */
export const secretOk = () => (process.env.HUB_SECRET || "").length >= 32;

function secret(): string {
  const s = process.env.HUB_SECRET || "";
  if (s.length < 32) throw new Error("HUB_SECRET must be set (32+ characters)");
  return s;
}

const mac = (payload: string) => createHmac("sha256", secret()).update("hub-session-v1." + payload).digest("base64url");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** `email` is the person's identity everywhere (audit trails, the Pi). It is
 *  their email if they have one on People, otherwise their username.
 *  `username` is set only for a personal login, not the shared password. */
export type Session = { email: string; username?: string; exp: number };

export function issueSession(email: string, username?: string): { value: string; maxAge: number } {
  const maxAge = SESSION_DAYS * 86400;
  const payload = Buffer.from(JSON.stringify({ email, username, exp: Date.now() + maxAge * 1000 })).toString("base64url");
  return { value: `${payload}.${mac(payload)}`, maxAge };
}

export function readSession(token: string | undefined): Session | null {
  if (!token || !secretOk()) return null; // a bad secret signs everyone out instead of crashing every page
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(mac(payload), sig)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export const cookieOptions = (maxAge: number) =>
  ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge });

/** For server components and actions: the signed-in board member, or off to /login. */
export async function requireBoard(): Promise<Session> {
  const s = readSession((await cookies()).get(HUB_COOKIE)?.value);
  if (!s) redirect("/login");
  return s;
}

export async function currentSession(): Promise<Session | null> {
  return readSession((await cookies()).get(HUB_COOKIE)?.value);
}

// --- personal logins ---------------------------------------------------------

export const normEmail = (e: string) => e.trim().toLowerCase();
export const normUsername = (u: string) => u.trim().toLowerCase();
export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
export const PASSWORD_MIN = 8;

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, o: { N: number; r: number; p: number }) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };

/** `scrypt$N$r$p$salt$key`. Salted and slow on purpose, so a database leak
 *  can't be turned into passwords cheaply. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, key] = stored.split("$");
  if (alg !== "scrypt" || !salt || !key) return false;
  const want = Buffer.from(key, "base64url");
  try {
    const got = await scrypt(pw, Buffer.from(salt, "base64url"), want.length, { N: +n, r: +r, p: +p });
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

// Checked against when the username doesn't exist, so "no such user" and
// "wrong password" take the same time.
let dummy: Promise<string> | null = null;

/** The identity to sign in as ({email, username}), or null. Only people on the
 *  current term's board, with a password set, can get in. */
export async function passwordLogin(username: string, password: string): Promise<{ email: string; username: string } | null> {
  const u = normUsername(username);
  await ensureSchema();
  const term = await currentTerm();
  const rows = (await sql()`SELECT email, username, password_hash FROM hub_people
    WHERE username = ${u} AND term = ${term} LIMIT 1`) as { email: string | null; username: string; password_hash: string | null }[];
  const row = rows[0];
  dummy ??= hashPassword(randomBytes(12).toString("base64url"));
  const ok = await verifyPassword(password, row?.password_hash || (await dummy));
  return row && row.password_hash && ok ? { email: row.email || row.username, username: row.username } : null;
}

/** The emergency shared password. */
export function sharedPasswordMatches(given: string): boolean {
  const want = process.env.HUB_PASSWORD || "";
  return want.length >= PASSWORD_MIN && safeEqual(want, given);
}

// Best effort: per function instance, so it slows guessing rather than
// stopping it. 10 tries per 5 minutes per key.
const attempts = new Map<string, number[]>();
export function rateOk(key: string, max = 10): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((t) => now - t < 300_000);
  recent.push(now);
  attempts.set(key, recent);
  return recent.length <= max;
}
