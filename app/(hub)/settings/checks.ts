// What the hub needs from its environment, checked by name only: values are
// never read back or shown.
export type Check = { key: string; label: string; ok: boolean; required: boolean; help: string };

const has = (k: string) => !!process.env[k];

export function setupChecks(): Check[] {
  return [
    { key: "DATABASE_URL", label: "Database", ok: has("DATABASE_URL"), required: true,
      help: "Vercel → Storage → add Neon. Use the same database the old merch till used, so its sales and stock carry over." },
    { key: "HUB_SECRET", label: "Session secret", ok: (process.env.HUB_SECRET || "").length >= 32, required: true,
      help: "The key that signs login cookies. Nobody types it, so make it long and random: 32+ characters, e.g. `openssl rand -base64 48`. Changing it signs everyone out." },
    { key: "HUB_PASSWORD", label: "Emergency shared password", ok: (process.env.HUB_PASSWORD || "").trim().length >= 8, required: true,
      help: "8+ characters. Gets the first person in before anyone has a personal login (then People → set usernames and passwords), and is the way back in if one is lost. Keep it in the SGA password manager." },
    { key: "VAULT_PASSWORD", label: "Vault password", ok: (process.env.VAULT_PASSWORD || "").trim().length >= 12, required: true,
      help: "12+ characters. The master password that opens Settings → Vault and encrypts what's stored there. Different from the Hub and till passwords; also keep it in your own password manager. To change it later, put the old one in VAULT_PASSWORD_PREVIOUS, redeploy, and press Re-encrypt in the vault." },
    { key: "POS_PASSWORD", label: "Till password", ok: has("POS_PASSWORD"), required: true,
      help: "The password sellers type on the tablet. Shared with volunteers, so it's separate from the board login." },
    { key: "BLOB_READ_WRITE_TOKEN", label: "File storage", ok: has("BLOB_READ_WRITE_TOKEN"), required: true,
      help: "Vercel → Storage → Create → Blob, access Private, connected to this project. Holds documents, receipt photos and meeting recordings (deleted once filed)." },
    { key: "GEMINI_API_KEY", label: "Gemini (meetings)", ok: has("GEMINI_API_KEY"), required: true,
      help: "Free key from aistudio.google.com, made with the SGA Google account. Optional GEMINI_MODEL (default gemini-2.5-flash). On the free tier Google may use the audio to improve its products." },
    { key: "NOTION_TOKEN", label: "Notion (meetings)", ok: has("NOTION_TOKEN") && has("NOTION_MEETINGS_DATA_SOURCE"), required: true,
      help: "An internal integration in the SGA workspace (notion.so/my-integrations) with Read, Update and Insert content, connected to the Meetings and Projects databases (••• → Connections). NOTION_TOKEN is its secret; NOTION_MEETINGS_DATA_SOURCE is the Meetings data source id; NOTION_PROJECTS_DATA_SOURCE (optional) lets meetings be tagged with projects. Also feeds Tasks." },
    { key: "KIOSK_TOKEN", label: "Coffee kiosk link", ok: (process.env.KIOSK_TOKEN || "").length >= 24, required: false,
      help: "24+ random characters, the same value as HUB_TOKEN on the Pi. The Pi uses it to report in every minute." },
    { key: "PI_API_URL", label: "Coffee kiosk, live", ok: !!process.env.PI_API_URL && (process.env.PI_API_TOKEN || "").length >= 32, required: false,
      help: "PI_API_URL is the Pi's public address (Tailscale Funnel, https://<node>.<tailnet>.ts.net). PI_API_TOKEN is 32+ random characters, the same value as HUB_API_TOKEN on the Pi. Steps: deploy/funnel/README.md in sga-coffee-kiosk." },
    { key: "CRON_SECRET", label: "Posting reminders", ok: has("CRON_SECRET"), required: false,
      help: "Any long random string. With it, Vercel runs the morning jobs (the posting reminder and the Notion task sync); without it they refuse to run and everything else still works." },
    { key: "NTFY_TOPIC", label: "ntfy alerts", ok: has("NTFY_TOPIC"), required: true,
      help: "A long, hard-to-guess topic name (anyone who knows it can read it). Optional NTFY_URL for a self-hosted server and NTFY_TOKEN for a protected topic." },
  ];
}
