"use server";

import { revalidatePath } from "next/cache";
import { rateOk, requireBoard } from "@/lib/auth";
import * as vault from "@/lib/vault";

const here = () => revalidatePath("/settings/vault");

/** Every action but unlocking needs the vault to be open for this person. */
async function opened() {
  const me = await requireBoard();
  if (!(await vault.openUntil(me))) throw new Error("The vault is locked. Open it again.");
  return vault.who(me);
}

export async function unlockVault(password: string): Promise<string | null> {
  const me = await requireBoard();
  const by = vault.who(me);
  if (vault.vaultState() !== "ok") return "The vault has no master password yet. Set VAULT_PASSWORD (12+ characters) in Vercel and redeploy.";
  if (!rateOk(`vault:${me.email}`, 5)) return "Too many tries. Wait a few minutes.";
  if (!vault.masterMatches(String(password ?? ""))) {
    await vault.log(by, "wrong password").catch(() => {});
    return "That isn't the vault password.";
  }
  await vault.openFor(me);
  await vault.log(by, "opened the vault");
  // The first time in, everything the SGA is known to hold is already listed.
  if (!(await vault.starterAdded())) await vault.addStarter(by);
  here();
  return null;
}

export async function lockVault() {
  const me = await requireBoard();
  await vault.close();
  await vault.log(vault.who(me), "locked the vault").catch(() => {});
  here();
}

/** One value for the person who pressed Show or Copy. Logged each time. */
export async function revealEntry(id: string, purpose: "show" | "copy"): Promise<{ value: string } | { error: string }> {
  let by: string;
  try { by = await opened(); } catch (e) { return { error: (e as Error).message }; }
  try {
    const r = await vault.revealSecret(String(id));
    if (!r) return { error: "Nothing is stored for this yet." };
    await vault.log(by, purpose === "copy" ? "copied" : "showed", r.label);
    return { value: r.value };
  } catch {
    return { error: "Couldn't read this one. The vault password may have changed since it was saved." };
  }
}

export async function saveVaultEntry(id: string | null, input: vault.EntryInput): Promise<string | null> {
  const by = await opened();
  const err = await vault.saveEntry(id, input, by);
  if (err) return err;
  await vault.log(by, id ? (input.secret ? "changed" : "edited") : "added", String(input.label ?? "").slice(0, 80));
  here();
  return null;
}

export async function deleteVaultEntry(id: string): Promise<void> {
  const by = await opened();
  const e = (await vault.listEntries()).find((x) => x.id === id);
  await vault.deleteEntry(id);
  await vault.log(by, "deleted", e?.label ?? "");
  here();
}

/** Adds any starter entries that aren't there yet (new ones appear as the Hub grows). */
export async function addStarterEntries(): Promise<string> {
  const by = await opened();
  const n = await vault.addStarter(by);
  if (n) await vault.log(by, "added starter entries", String(n));
  here();
  return n ? `Added ${n} to the list.` : "Everything on the starter list is already here.";
}

/** After changing VAULT_PASSWORD: re-encrypt what the old one (VAULT_PASSWORD_PREVIOUS) protected. */
export async function reencrypt(): Promise<string> {
  const by = await opened();
  const r = await vault.checkReadable(true);
  await vault.log(by, "re-encrypted", `${r.rotated} done, ${r.unreadable} unreadable`);
  here();
  return r.unreadable
    ? `${r.rotated} re-encrypted. ${r.unreadable} still can't be read: they need the password they were saved with, in VAULT_PASSWORD_PREVIOUS.`
    : `${r.rotated} re-encrypted. Everything reads with the current password. You can remove VAULT_PASSWORD_PREVIOUS.`;
}
