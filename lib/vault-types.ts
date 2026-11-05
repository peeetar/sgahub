// The vault's shapes and labels, with nothing server-only in them, so the
// Vault page (a client component) can share them with lib/vault.ts.

export const KINDS = { password: "Password", login: "Login", key: "Key / token", link: "Link", note: "Note" } as const;
export type Kind = keyof typeof KINDS;

export type VaultEntry = {
  id: string; category: string; label: string; kind: Kind; username: string; url: string; notes: string;
  filled: boolean; updated_by: string | null; updated_at: string;
};

export type EntryInput = {
  category: string; label: string; kind: string; username: string; url: string; notes: string;
  /** undefined keeps the stored value; `clear` removes it. */
  secret?: string; clear?: boolean;
};

export type LogRow = { at: string; who: string; action: string; detail: string };
