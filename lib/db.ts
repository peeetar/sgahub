// Server only. One Neon database for the whole hub.
//
// `merch_rows` is the till's cloud copy: every tablet pushes its outbox here
// and pulls everyone else's rows back. One table holds every kind of till row
// as JSON; the data is small and the maths happens on the tablet.
//
// The `hub_*` tables are the board side: people, roles, sign-in logins, alert
// state and settings. They are plain tables because the server reads them.
import { neon, neonConfig } from "@neondatabase/serverless";
import { ROLES } from "./roles";

// Local development only: point the driver at a Neon-compatible HTTP endpoint
// (e.g. a local proxy) instead of the real Neon. Unset in production.
if (process.env.NEON_FETCH_ENDPOINT) neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;

export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

let ready: Promise<unknown> | null = null;

export function ensureSchema() {
  ready ??= (async () => {
    const q = sql();
    await q.transaction([
      q`CREATE TABLE IF NOT EXISTS merch_rows (
        store      TEXT NOT NULL,
        id         TEXT NOT NULL,
        data       JSONB NOT NULL,
        synced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (store, id)
      )`,
      q`CREATE TABLE IF NOT EXISTS hub_roles (
        id      TEXT PRIMARY KEY,
        title   TEXT NOT NULL,
        duties  TEXT NOT NULL DEFAULT '',
        seats   INT NOT NULL DEFAULT 1,
        sort    INT NOT NULL DEFAULT 0
      )`,
      q`CREATE TABLE IF NOT EXISTS hub_people (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        role_id         TEXT REFERENCES hub_roles(id) ON DELETE SET NULL,
        email           TEXT,
        notion_user_id  TEXT,
        term            TEXT NOT NULL,
        notes           TEXT NOT NULL DEFAULT '',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      q`CREATE INDEX IF NOT EXISTS hub_people_term ON hub_people (term)`,
      // Per-person sign-in: a lowercase username and a salted scrypt hash.
      q`ALTER TABLE hub_people ADD COLUMN IF NOT EXISTS username TEXT`,
      q`ALTER TABLE hub_people ADD COLUMN IF NOT EXISTS password_hash TEXT`,
      q`CREATE UNIQUE INDEX IF NOT EXISTS hub_people_username ON hub_people (username, term) WHERE username IS NOT NULL`,
      q`CREATE TABLE IF NOT EXISTS hub_alert_state (
        key    TEXT PRIMARY KEY,
        level  TEXT NOT NULL,
        at     TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      q`CREATE TABLE IF NOT EXISTS hub_settings (
        key    TEXT PRIMARY KEY,
        value  JSONB NOT NULL
      )`,
      // Files in the private Blob store: documents, photos, receipts.
      q`CREATE TABLE IF NOT EXISTS hub_docs (
        id            TEXT PRIMARY KEY,
        pathname      TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        content_type  TEXT NOT NULL,
        size          BIGINT NOT NULL,
        folder        TEXT NOT NULL DEFAULT 'General',
        tags          TEXT[] NOT NULL DEFAULT '{}',
        note          TEXT NOT NULL DEFAULT '',
        uploaded_by   TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      // Money that isn't a till sale or a kiosk top-up: spending, receipts,
      // reimbursements, and income typed in by hand. Rows are never deleted,
      // only voided, so the books can always be explained.
      q`CREATE TABLE IF NOT EXISTS hub_ledger (
        id             TEXT PRIMARY KEY,
        kind           TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
        occurred_on    DATE NOT NULL,
        cents          INT NOT NULL CHECK (cents > 0),
        category       TEXT NOT NULL,
        description    TEXT NOT NULL,
        method         TEXT NOT NULL DEFAULT 'cash',
        paid_by        TEXT,
        reimbursed_on  DATE,
        doc_id         TEXT REFERENCES hub_docs(id) ON DELETE SET NULL,
        import_ref     TEXT UNIQUE,
        created_by     TEXT NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        voided_at      TIMESTAMPTZ,
        void_reason    TEXT
      )`,
      // The kiosk reports in; the hub keeps its latest report and every cash
      // top-up (amount only, never who), and queues commands for it.
      q`CREATE TABLE IF NOT EXISTS hub_kiosk_state (
        id           INT PRIMARY KEY CHECK (id = 1),
        report       JSONB NOT NULL,
        received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      q`CREATE TABLE IF NOT EXISTS hub_kiosk_topups (
        id       TEXT PRIMARY KEY,
        at       TIMESTAMPTZ NOT NULL,
        cents    INT NOT NULL,
        coffees  INT NOT NULL
      )`,
      q`CREATE TABLE IF NOT EXISTS hub_kiosk_commands (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        args        JSONB NOT NULL DEFAULT '{}',
        created_by  TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        picked_at   TIMESTAMPTZ,
        done_at     TIMESTAMPTZ,
        ok          BOOLEAN,
        result      TEXT
      )`,
      // The coffee cash box: shifts and top-ups sold from the hub, kept here
      // until the Pi has them. `synced` is the version the Pi last accepted.
      q`CREATE TABLE IF NOT EXISTS hub_coffee_rows (
        kind        TEXT NOT NULL CHECK (kind IN ('shift', 'sale')),
        id          TEXT NOT NULL,
        data        JSONB NOT NULL,
        version     INT NOT NULL DEFAULT 1,
        synced      INT NOT NULL DEFAULT 0,
        rejected    TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (kind, id)
      )`,
      // A meeting recording on its way to Notion. `status` is the next step
      // to run (upload, transcribe, notes, notion, done), so a failed one
      // carries on from there; `running_since` stops two runs at once.
      q`CREATE TABLE IF NOT EXISTS hub_marketing_docs (
        tool        TEXT PRIMARY KEY,
        doc         JSONB NOT NULL,
        version     INT NOT NULL DEFAULT 1,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by  TEXT
      )`,
      q`CREATE TABLE IF NOT EXISTS hub_calendar (
        id           SERIAL PRIMARY KEY,
        date         TEXT NOT NULL,
        channel      TEXT NOT NULL,
        title        TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'idea',
        owner        TEXT,
        tool         TEXT,
        notes        TEXT,
        source       TEXT,
        reminded_on  TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      q`CREATE INDEX IF NOT EXISTS hub_calendar_date ON hub_calendar (date)`,
      q`CREATE TABLE IF NOT EXISTS hub_meetings (
        id           TEXT PRIMARY KEY,
        title        TEXT NOT NULL,
        kind         TEXT NOT NULL,
        held_on      DATE NOT NULL,
        start_time   TEXT NOT NULL,
        attendees    JSONB NOT NULL DEFAULT '[]',
        others       TEXT NOT NULL DEFAULT '',
        audio_path   TEXT,
        status       TEXT NOT NULL,
        running_since TIMESTAMPTZ,
        error        TEXT,
        gemini_file  TEXT,
        transcript   TEXT,
        notes        JSONB,
        notion_url   TEXT,
        created_by   TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      // The board's calendar: school dates, SGA events, deadlines, meetings.
      // `ends_on` is the last day of a multi-day event (NULL: one day) and a
      // NULL `start_time` means all day. `import_ref` makes a pasted schedule
      // safe to paste twice.
      q`CREATE TABLE IF NOT EXISTS hub_events (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        starts_on   DATE NOT NULL,
        ends_on     DATE,
        start_time  TEXT,
        end_time    TEXT,
        location    TEXT NOT NULL DEFAULT '',
        category    TEXT NOT NULL DEFAULT 'event',
        notes       TEXT NOT NULL DEFAULT '',
        source      TEXT NOT NULL DEFAULT 'manual',
        import_ref  TEXT UNIQUE,
        created_by  TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      q`CREATE INDEX IF NOT EXISTS hub_events_day ON hub_events (starts_on)`,
      // Tasks. Some are typed in; others are action items read from the Notion
      // meeting notes (`source = 'notion'`), keyed by the table row they came
      // from so closing one here can be written back to that row.
      q`CREATE TABLE IF NOT EXISTS hub_tasks (
        id               TEXT PRIMARY KEY,
        title            TEXT NOT NULL,
        notes            TEXT NOT NULL DEFAULT '',
        owner_id         TEXT REFERENCES hub_people(id) ON DELETE SET NULL,
        owner_name       TEXT NOT NULL DEFAULT '',
        due_on           DATE,
        status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'blocked', 'done', 'dismissed')),
        source           TEXT NOT NULL DEFAULT 'manual',
        title_key        TEXT NOT NULL DEFAULT '',
        notion_block_id  TEXT,
        notion_col       INT,
        notion_page_id   TEXT,
        notion_url       TEXT,
        meeting_title    TEXT,
        notion_error     TEXT,
        completed_at     TIMESTAMPTZ,
        completed_by     TEXT,
        created_by       TEXT NOT NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      q`CREATE INDEX IF NOT EXISTS hub_tasks_due ON hub_tasks (due_on)`,
      q`CREATE INDEX IF NOT EXISTS hub_tasks_key ON hub_tasks (title_key)`,
      // The vault: every secret the SGA holds. Values are encrypted (AES-256-GCM,
      // key derived from VAULT_PASSWORD), so a copy of the database alone reads
      // as noise. `seed_key` marks entries from the starter list so adding it
      // again never duplicates.
      q`CREATE TABLE IF NOT EXISTS hub_vault (
        id          TEXT PRIMARY KEY,
        category    TEXT NOT NULL,
        label       TEXT NOT NULL,
        kind        TEXT NOT NULL DEFAULT 'password',
        username    TEXT NOT NULL DEFAULT '',
        url         TEXT NOT NULL DEFAULT '',
        secret_enc  TEXT,
        notes       TEXT NOT NULL DEFAULT '',
        sort        INT NOT NULL DEFAULT 0,
        seed_key    TEXT UNIQUE,
        updated_by  TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      // Who opened the vault and what they touched. Never the values.
      q`CREATE TABLE IF NOT EXISTS hub_vault_log (
        id      SERIAL PRIMARY KEY,
        at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        who     TEXT NOT NULL,
        action  TEXT NOT NULL,
        detail  TEXT NOT NULL DEFAULT ''
      )`,
    ]);
    // The positions are the same every year; who holds them is not, so only
    // the roles are seeded. People are added from the People page.
    await q.transaction(ROLES.map((r, i) => q`
      INSERT INTO hub_roles (id, title, duties, seats, sort)
      VALUES (${r.id}, ${r.title}, ${r.duties}, ${r.seats}, ${i})
      ON CONFLICT (id) DO NOTHING`));
  })().catch((err) => {
    ready = null; // try again on the next request
    throw err;
  });
  return ready;
}

/** Forget that the schema was checked, so the next request checks again
 *  (e.g. after the database was reset under a warm function). */
export function resetSchema() {
  ready = null;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  await ensureSchema();
  const rows = (await sql()`SELECT value FROM hub_settings WHERE key = ${key}`) as { value: T }[];
  return rows.length ? rows[0].value : fallback;
}

export async function setSetting(key: string, value: unknown) {
  await ensureSchema();
  await sql()`INSERT INTO hub_settings (key, value) VALUES (${key}, ${JSON.stringify(value)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

/** The academic year the board is serving, e.g. "2026-27". Stored, so the
 *  handover is one button rather than a redeploy. */
export function defaultTerm(d = new Date()) {
  // A new board takes over in the summer; from August it's the next year.
  const y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

export const currentTerm = () => getSetting("term", defaultTerm());
