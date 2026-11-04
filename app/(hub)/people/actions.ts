"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { PASSWORD_MIN, USERNAME_RE, hashPassword, normEmail, normUsername, requireBoard, verifyPassword } from "@/lib/auth";
import { currentTerm, ensureSchema, sql } from "@/lib/db";

export type PersonInput = {
  name: string; role_id: string | null; email: string; notion_user_id: string; notes: string; term: string;
  /** Personal login. A blank password on an existing login keeps the old one. */
  username: string; password: string;
};

const clean = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const NOTION_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

function check(p: PersonInput): string | null {
  if (!clean(p.name, 80)) return "Name is required.";
  const email = clean(p.email, 200);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return `"${email}" isn't an email address.`;
  const nid = clean(p.notion_user_id, 60);
  if (nid && !NOTION_ID.test(nid)) return "The Notion user ID should look like 1a2b3c4d-0000-4000-8000-00000000abcd.";
  if (!/^\d{4}-\d{2}$/.test(p.term)) return "Bad term.";
  const username = normUsername(p.username ?? "");
  if (username && !USERNAME_RE.test(username)) return "Username: 3 to 32 letters, numbers, dots, dashes or underscores.";
  const pw = String(p.password ?? "");
  if (pw && !username) return "Give them a username to go with the password.";
  if (pw && (pw.length < PASSWORD_MIN || pw.length > 200)) return `Password must be at least ${PASSWORD_MIN} characters.`;
  return null;
}

export async function savePerson(id: string | null, p: PersonInput): Promise<string | null> {
  await requireBoard();
  const err = check(p);
  if (err) return err;
  await ensureSchema();
  const q = sql();
  const username = normUsername(p.username ?? "") || null;
  const hash = p.password ? await hashPassword(p.password) : null;
  const vals = {
    name: clean(p.name, 80), role: p.role_id || null, email: clean(p.email, 200) ? normEmail(p.email) : null,
    nid: clean(p.notion_user_id, 60) || null, notes: String(p.notes ?? "").trim().slice(0, 1000), term: p.term,
  };
  try {
    if (id) {
      // No username: the login is removed. A username with a blank password keeps the old password.
      await q`UPDATE hub_people SET name = ${vals.name}, role_id = ${vals.role}, email = ${vals.email},
        notion_user_id = ${vals.nid}, notes = ${vals.notes}, term = ${vals.term}, username = ${username}::text,
        password_hash = CASE WHEN ${username}::text IS NULL THEN NULL ELSE COALESCE(${hash}::text, password_hash) END
        WHERE id = ${id}`;
    } else {
      await q`INSERT INTO hub_people (id, name, role_id, email, notion_user_id, notes, term, username, password_hash)
        VALUES (${randomUUID()}, ${vals.name}, ${vals.role}, ${vals.email}, ${vals.nid}, ${vals.notes}, ${vals.term}, ${username}, ${hash})`;
    }
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return `The username "${username}" is already taken.`;
    throw err;
  }
  revalidatePath("/people");
  return null;
}

export async function removePerson(id: string) {
  await requireBoard();
  await ensureSchema();
  await sql()`DELETE FROM hub_people WHERE id = ${id}`;
  revalidatePath("/people");
}

/** Paste a whole board at once, one person per line:
 *  `Role | Name | email | Notion user ID` (the last two optional). The role
 *  can be its title or a word from it ("Treasurer", "Junior"). */
export async function importPeople(text: string, term: string): Promise<{ added: number; errors: string[] }> {
  await requireBoard();
  await ensureSchema();
  const q = sql();
  const roles = (await q`SELECT id, title FROM hub_roles`) as { id: string; title: string }[];
  const findRole = (r: string) => {
    const k = r.trim().toLowerCase();
    if (!k) return null;
    return roles.find((x) => x.title.toLowerCase() === k || x.id === k)
      ?? roles.find((x) => x.title.toLowerCase().includes(k))
      ?? roles.find((x) => k.split(/\s+/).every((w) => x.title.toLowerCase().includes(w)))
      ?? null;
  };
  const errors: string[] = [];
  const rows: PersonInput[] = [];
  text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).forEach((line, i) => {
    const [role, name, email = "", nid = ""] = line.split("|").map((s) => s.trim());
    const r = findRole(role || "");
    if (!r) return errors.push(`Line ${i + 1}: no role matches "${role}".`);
    const p = { name: name || "", role_id: r.id, email, notion_user_id: nid, notes: "", term, username: "", password: "" };
    const err = check(p);
    if (err) return errors.push(`Line ${i + 1}: ${err}`);
    rows.push(p);
  });
  if (errors.length) return { added: 0, errors }; // all or nothing, so a fix-and-retry doesn't double people up
  if (rows.length) {
    await q.transaction(rows.map((p) => q`
      INSERT INTO hub_people (id, name, role_id, email, notion_user_id, notes, term)
      VALUES (${randomUUID()}, ${clean(p.name, 80)}, ${p.role_id}, ${clean(p.email, 200) ? normEmail(p.email) : null}, ${clean(p.notion_user_id, 60) || null}, '', ${p.term})`));
  }
  revalidatePath("/people");
  return { added: rows.length, errors };
}

export async function saveDuties(roleId: string, duties: string) {
  await requireBoard();
  await ensureSchema();
  await sql()`UPDATE hub_roles SET duties = ${duties.trim().slice(0, 2000)} WHERE id = ${roleId}`;
  revalidatePath("/people");
}

/** A signed-in person changing their own password. */
export async function changeMyPassword(current: string, next: string): Promise<string | null> {
  const me = await requireBoard();
  if (!me.username) return "You signed in with the emergency shared password. Sign in with your own username to change yours.";
  if (next.length < PASSWORD_MIN || next.length > 200) return `Use at least ${PASSWORD_MIN} characters.`;
  await ensureSchema();
  const q = sql();
  const rows = (await q`SELECT password_hash FROM hub_people WHERE username = ${me.username} AND term = ${await currentTerm()} LIMIT 1`) as { password_hash: string | null }[];
  if (!rows[0]?.password_hash || !(await verifyPassword(current, rows[0].password_hash))) return "Your current password is wrong.";
  await q`UPDATE hub_people SET password_hash = ${await hashPassword(next)} WHERE username = ${me.username} AND term = ${await currentTerm()}`;
  return null;
}
