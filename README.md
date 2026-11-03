# SGA Hub

One place for the SGA board: the till, stock, money, people, meetings and the
coffee kiosk. It is hosted on Vercel, independent of the kiosk, so everything
keeps working when the kiosk's Pi is offline. It is meant to be the single
source of truth for stock and the system, and to be handed down to each new
board without anyone having to rebuild it.

Next.js on Vercel (`fra1`), Neon Postgres, ntfy for alerts, Resend for sign-in
emails.

## What's in it

| Module | Status |
|---|---|
| **Overview**: today's takings, open cash boxes, what's running low, the board | ✅ |
| **Till** (`/pos`): the tablet till, offline-first, cash only | ✅ |
| **Till & merch** (`/merch`): takings, stock on hand, cash boxes, sales CSV | ✅ |
| **People**: every SGA position, who holds it this term, handover | ✅ |
| **Settings**: setup checklist, ntfy topic and test alert, term switch | ✅ |
| **Finance**: one ledger for till sales, kiosk top-ups, spending, receipts and reimbursements | ✅ |
| **Meetings**: voice memo → Gemini → notes and transcript in Notion | ✅ |
| **Coffee kiosk**: live status, selling with a cash box, students, stock, sign-ups, alerts, cash, sales, system and the activity log | ✅ with `sga-coffee-kiosk` |
| **Documents**: photos and files in a private Vercel Blob store | ✅ |
| Event supplies: snacks, drinks, BBQ stock and a how-much-to-buy planner | on hold, waiting for past receipts |
| Year-end report (PDF) | on hold, contents to be decided |

## Signing in

Everyone on the board has the same access.

- **Board** (`/login`): type your ACT email and get a one-time sign-in link,
  valid for 15 minutes. Anyone listed on **People** for the current term with
  an email can ask for one. The link opens a page with a *Sign in* button
  rather than signing in straight away, because Outlook's link scanner would
  otherwise use up the link before you click it. A device stays signed in for
  30 days.
- **Fallback**: if `HUB_PASSWORD` is set, *Use the shared password* signs in
  without email.
- **First sign-in**: before anyone is on People, the addresses in
  `HUB_BOOTSTRAP_EMAILS` can sign in. Clear it once People is filled in.
- **Till** (`/pos`): its own password, `POS_PASSWORD`, because volunteers who
  aren't on the board sell too. It works the way the old merch till did: the
  first unlock needs internet, then it also works offline for 12 hours.

## The till

It's the SGA merch POS moved in, with three additions:

- **Any article.** *+ New product* → *Colours & sizes* (hoodies, tees) or
  *Plain article* (a tote, a sticker, a can of cola), which the till adds in
  one tap.
- **Categories** (Merch, Snacks, Drinks…) group the sell screen.
- **Low-stock mark per product.** By default a sized item warns when a size
  sells out (merch comes in ones and twos per size), and a plain article warns
  at 3 left.

Everything else is unchanged: cash box counted note by note, change shown as
notes and coins, voids that put stock back, shift close with over/short,
stats, CSV. Stock is a ledger, so two tablets selling offline merge cleanly.
See the comments in `lib/merge.ts`.

**Install it on the tablet**: open `/pos` and use *Add to Home Screen*. It
opens full-screen at the till and keeps working with no signal.

## Alerts

All alerts go to one ntfy topic (`NTFY_TOPIC`). Everyone on the board
installs the ntfy app and subscribes to it. *Settings → Send a test alert*
checks it works. So far the hub sends:

- **Merch running low** and **sold out**, after a tablet syncs. Each size
  alerts once per level, and a delivery re-arms it. The first check after
  going live only records a baseline, so nobody gets paged about sizes that
  were never ordered.

Kiosk alerts join once the kiosk is connected.

## Finance

One list per term (1 Aug–31 Jul), with *Fall* and *Spring* views for the
mid-year and end-of-year reports. Cash is the only money there is.

- **Automatic:** till sales and kiosk cash top-ups, one line per day, read from
  where they happen, so they're never typed twice.
- **Typed in:** spending (with a receipt photo), who paid out of their own
  pocket, and when they were paid back. *Owed to people* totals what's still
  due; *Paid back* settles it. Entries are voided, never deleted.
- **Import from sheet:** copy rows (with the header) from the Treasurer's
  Google Sheet and paste them in. Columns are matched by header; a total row
  is skipped; pasting the same rows again adds nothing. For the beta the hub
  is the record; reading the sheet live comes later.
- **Till pay-outs** (cash taken out of a till box) are listed separately, so
  they aren't counted twice.
- **Export CSV** for the report.

## Marketing

Marketing HQ (`/marketing`) has six tools: Overview (charter, key dates,
sign-offs, launch numbers, credited roles), Announcement, Flavour drop, How-to
carousel, One-month post and CV kit. Each is one JSON document in
`hub_marketing_docs`, saved a moment after you stop typing with a version
number. If two people edit the same tool, the second is told who saved first and
can reload theirs or overwrite. The pictures are drawn in the browser and no
image is ever stored (a flavour drop saves the capsule's sku, and a picture
dropped in is for that session only).

- **People:** the team is the People page for this term. How each person is
  credited, and anyone credited who isn't on it (advisors, the library), is kept
  in the Overview document.
- **Names stay out of this repo.** The suggested titles and CV bullets are in the
  database. *Import* takes a private JSON file (`{"docs": {"overview": {...}}}`),
  or the old single-file tool's browser data. It previews first and never
  overwrites a saved tool unless you ask.
- **Launch numbers and prices** come from the kiosk, and the last ones it gave are
  kept for when it's off. Type over a number to use your own.
- **Dates:** *Edit dates* on the Overview. The announcement's date is its own
  field, and the first save of a tool freezes its default copy.

The content calendar (`/marketing/calendar`) is a month grid, an agenda on
phones, with status idea, draft, ready or posted, an owner, and the tool that
makes the asset. It suggests posts from what the machine did: the 100th (250th,
500th, 1000th) coffee, a newly loaded flavour, and one month since the first
coffee. On a morning a post is due, `/api/calendar/remind` sends one ntfy message
naming the owner. It runs on a Vercel cron at 06:00 UTC and refuses to run
without `CRON_SECRET`.

## Meetings

*+ New recording*: pick board / Dean / other, the date, who was there, and the
voice memo. With the Meetings page open, the hub then runs four steps, one
request each, saving after every step:

1. send the recording from Blob to Gemini;
2. transcribe it (`[mm:ss]` lines), then apply the board's fixes list
   (*Names & fixes*, e.g. `Sweden government => Student Government`);
3. write the notes in the board's format: summary, attendees, main
   decisions, one section per topic, action items, next meeting, plus what
   was assumed or unclear;
4. file the page in the Notion Meetings database (Attendees, Summary,
   Projects), with the transcript in a toggle at the bottom, then delete the
   recording from Blob.

If a step fails (a missing key, or the free tier's per-minute limit), the
meeting page shows why and *Try again* carries on from that step. *Rewrite
notes* redoes step 3 from the saved transcript. *Names & fixes* is kept in
the database, not here, because it is mostly people's names.

On Gemini's free tier, Google may use what's sent to improve its products.
The board agreed that's fine for meeting audio.

## Coffee kiosk link

There are two lines, and both are needed.

This hub is the only dashboard the board uses. The kiosk doesn't depend on it:
vending, PINs and balances all live on the Pi, in its own repo.

**The hub calls the Pi, live** (`lib/pi.ts`). Everything under *Coffee kiosk*. Only
this server talks to the Pi, over Tailscale Funnel at `PI_API_URL` with
`PI_API_TOKEN`; browsers never do. Each call carries the signed-in board member's
email for the Pi's audit log. Students stay on the Pi: the only student IDs kept
here are on the open shift's sales and any waiting or refused, and a closed shift
is deleted once the Pi has it. Hardware tests, restarts, deploys,
settings and editing the capsule catalogue aren't reachable this way on purpose:
they're for whoever looks after the Pi, over SSH. The Pi's `services/hub_api.py`
is the list. With the Pi offline the live pages say so, and *Status* falls back
to the last report below.

**Upkeep** (`/kiosk/upkeep`) is the machine's recurring jobs, counted in coffees,
days, or whichever comes first, and the message on the kiosk's attract screen.

**Sell** is the coffee cash box: count it in, sell, close it with a recount. Sales
and shifts are saved here first (`lib/sell.ts`), then sent to the Pi, which counts
each id once however often it arrives. With the Pi off, selling still works and
sales wait here; they go out on the next page view, sale, or minute report.
Selling needs internet on the seller's device, unlike the merch till.

The *Top up* button on a student's page goes straight to the Pi and needs it
online. It carries a request id, so if the Pi doesn't answer, pressing the same
amount again is safe. It doesn't count in a cash box; that's what Sell is for.

**The Pi calls the hub, every minute.** This keeps *Status* and Finance working
when the Pi can't be reached. Every minute it POSTs to
`/api/kiosk/report` with `Authorization: Bearer <KIOSK_TOKEN>`:

```json
{
  "boot_id": "…", "version": "<git sha>", "reported_at": "<ISO time>",
  "mode": "in_service | maintenance | out_of_service",
  "columns": [{ "index": 0, "name": "Ristretto", "sku": "…", "color": "#304E84", "stock": 7, "capacity": 10, "enabled": true }],
  "today": { "vends": 14, "failed": 1, "topups_cents": 1500 },
  "health": { "cpu_temp_c": 51.2, "sd_card": "Healthy" },
  "alerts": [{ "code": "jam", "level": "error", "detail": "…", "since": "…" }],
  "topups": [{ "id": "grant-123", "at": "<ISO time>", "cents": 500, "coffees": 6 }]
}
```

Top-ups are amounts only (never who), stored once per `id`, and feed
Finance. The reply carries the queued commands:
`{ "commands": [{ "id", "kind": "maintenance" | "refill" | "reload", "args" }] }`.
`refill` args are `{ column, to }` or `{ column, add }`; `maintenance` is
`{ on }`. The Pi runs each id once and reports back to `/api/kiosk/ack` with
`{ id, ok, result }`. A command not picked up within 15 minutes expires.
The hub shows the last report with "last seen", so the hub keeps working while
the kiosk is offline. The Pi's own alerts (offline, jams, stock) go to the same
ntfy topic.

## Setup (Vercel)

1. New Vercel project from this repo. The region is pinned to `fra1` in
   `vercel.json`.
2. **Database**: connect the **same Neon database the merch till used**
   (Storage → Neon, or copy its `DATABASE_URL`). The till's table
   (`merch_rows`) is reused as is, so every sale, shift and stock move carries
   over. The hub's own tables (`hub_*`) are created on first use.
3. Environment variables, listed in `.env.example`. *Settings* in the hub
   shows which are missing; values never leave Vercel.
4. **File storage**: Storage → Create → **Blob**, access **Private**,
   connected to the project (sets `BLOB_READ_WRITE_TOKEN`).
5. **Gemini**: a free API key from aistudio.google.com, made with the SGA
   Google account → `GEMINI_API_KEY`.
6. **Notion**: an internal integration in the SGA workspace
   (notion.so/my-integrations). Connect it to the Meetings and Projects
   databases (••• → Connections), then set `NOTION_TOKEN`,
   `NOTION_MEETINGS_DATA_SOURCE` (the Meetings data source id) and optionally
   `NOTION_PROJECTS_DATA_SOURCE`.
7. **Kiosk**: `KIOSK_TOKEN` (24+ random characters, the same as `HUB_TOKEN`
   on the Pi), and `PI_API_URL` and `PI_API_TOKEN` for
   the live pages (`deploy/funnel/README.md` in `sga-coffee-kiosk`).
8. **Resend**: create the account with the SGA mailbox, verify a sending
   domain, and set `RESEND_API_KEY` and `HUB_EMAIL_FROM`. Without a verified
   domain, Resend only delivers to the account's own address. Until then, the
   shared password works.
9. Sign in with a bootstrap email or the shared password, go to **People**,
   then *Paste a list*.
10. Move the merch tablets together, between sales: sync each one on the old
   address, then add `https://sgahub.vercel.app/pos` to its home screen. Unsynced
   sales don't carry over, because the new address has its own offline storage.
   Retire the old till's Vercel project once every tablet has moved.

`scripts/finish-setup.sh` does steps 3 and 7 from a laptop: it asks only for what's
missing, makes the tokens, and with `--pi-url` gives the Hub the Pi's address.

Every push to `main` deploys on Vercel. CI (`.github/workflows/ci.yml`) runs
the typecheck and build on every push and PR.

## Handing over to the next board

1. On **People**, pick the new term and add the new board (or *Paste a list*:
   `Role | Name | email | Notion user ID`).
2. **Settings → Handover → Switch term.** From then on only the new board can
   sign in; last year's stays on record under its own term.
3. Rotate `POS_PASSWORD`, `HUB_PASSWORD` and, if anyone leaving knew it, the
   ntfy topic. Update the SGA password manager.
4. Make sure the Vercel, Neon, Resend and GitHub accounts are owned by the SGA
   mailbox, not a person.

Names and emails live in the database, never in this repo.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in at least HUB_SECRET and POS_PASSWORD
npm run dev
npm run typecheck
```

`NEON_FETCH_ENDPOINT` points the Neon driver at a local Neon-compatible HTTP
endpoint, so you can run against a local Postgres. Without a database the till
still sells offline, and the hub pages say the database is missing.

## Files

- `app/(hub)/`: board pages (overview, merch, people, settings), behind `requireBoard()`
- `app/pos/`: the till · `components/`: its screens (`Sell`, `Stock`, `CashBox`, `Stats`)
- `app/api/auth/*`: sign-in links, fallback password · `app/api/pos/*`: till login and sync
- `lib/auth.ts`: board sessions and sign-in tokens · `lib/session.ts`: the till's session
- `lib/db.ts`: schema and settings · `lib/roles.ts`: the SGA positions
- `lib/calc.ts`, `lib/merge.ts`, `lib/local.ts`: the till's maths, merge rules and offline copy
- `lib/merch.ts`, `lib/stock-alerts.ts`: what the hub reads from the till, and the ntfy alerts
- `lib/notify.ts`: Resend and ntfy · `lib/time.ts`: Athens days and times
- `lib/finance.ts`, `lib/sheet-import.ts`: the ledger and the Google Sheet paste
- `lib/meetings.ts`, `lib/gemini.ts`, `lib/notion.ts`: the meetings pipeline
- `lib/kiosk.ts`, `app/api/kiosk/*`: the kiosk's reports and commands
- `lib/marketing.ts`, `lib/content-calendar.ts`, `app/api/marketing/*`, `app/api/calendar/*`: Marketing HQ and the calendar
- `components/marketing/`: their tools, plain DOM modules mounted by `MarketingHost.tsx`
- `lib/files.ts`, `app/api/files/*`: private uploads and downloads
