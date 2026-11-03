#!/usr/bin/env bash
# Sets whatever is still missing on the Vercel project, from a laptop, in the
# sgahub folder, logged in with `vercel login` and linked with `vercel link`:
#
#     bash scripts/finish-setup.sh                      # what's missing, and set it
#     bash scripts/finish-setup.sh --pi-url https://…   # also give the Hub the Pi's address
#     bash scripts/finish-setup.sh --new-tokens         # replace the two Pi tokens
#
# Pressing Enter skips anything optional. It never prints an existing value:
# Vercel doesn't give them back. Tokens it makes are shown once, for the Pi and
# the SGA password manager. deploy/connect.sh on the Pi asks for them.
#
# Then it redeploys, which is how Vercel picks up a changed variable.

set -uo pipefail

PI_URL=""
NEW_TOKENS=0
while (( $# )); do
    case $1 in
        --pi-url) PI_URL=${2:-}; shift 2 ;;
        --new-tokens) NEW_TOKENS=1; shift ;;
        *) echo "usage: bash scripts/finish-setup.sh [--pi-url URL] [--new-tokens]" >&2; exit 2 ;;
    esac
done

command -v vercel >/dev/null || { echo "Install the Vercel CLI first: npm i -g vercel" >&2; exit 1; }
existing=$(vercel env ls production 2>/dev/null) || { echo "Run vercel link in this folder first." >&2; exit 1; }

has() { grep -qE "^[[:space:]]*$1[[:space:]]" <<<"$existing"; }
random() { openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48; }

changes=0
put() {         # put KEY VALUE [--sensitive|--no-sensitive]
    printf %s "$2" | vercel env add "$1" production "${3:---sensitive}" --yes --force >/dev/null \
        && { echo "  set $1"; changes=$((changes + 1)); } \
        || echo "  FAILED to set $1"
}
ask() {         # ask KEY "what it is" [--no-sensitive]
    has "$1" && { echo "  ok  $1"; return; }
    local value
    printf '  %s (%s, Enter skips): ' "$1" "$2"
    if [[ ${3:-} == --no-sensitive ]]; then read -r value; else read -rs value; echo; fi
    [[ -n $value ]] && put "$1" "$value" "${3:---sensitive}"
}

echo "== Sign-in and the database"
has DATABASE_URL && echo "  ok  DATABASE_URL" || echo "  MISSING DATABASE_URL: connect the Neon database in Vercel → Storage"
has HUB_SECRET && echo "  ok  HUB_SECRET" || put HUB_SECRET "$(random)"
has CRON_SECRET && echo "  ok  CRON_SECRET" || put CRON_SECRET "$(random)"
ask HUB_PASSWORD "shared fallback password, 12+ characters"
ask HUB_BOOTSTRAP_EMAILS "comma-separated emails that can sign in first" --no-sensitive
ask POS_PASSWORD "the password sellers type on the till"

echo "== Email sign-in, alerts, meetings (any can wait)"
ask RESEND_API_KEY "from resend.com, on the SGA mailbox"
ask HUB_EMAIL_FROM 'for example: SGA Hub <hub@your-domain>' --no-sensitive
ask NTFY_TOPIC "long and hard to guess" --no-sensitive
ask GEMINI_API_KEY "from aistudio.google.com, on the SGA Google account"
ask NOTION_TOKEN "the SGA workspace's internal integration"
ask NOTION_MEETINGS_DATA_SOURCE "the Meetings data source id" --no-sensitive
ask NOTION_PROJECTS_DATA_SOURCE "the Projects data source id" --no-sensitive
has BLOB_READ_WRITE_TOKEN && echo "  ok  BLOB_READ_WRITE_TOKEN" || echo "  note: file storage: Vercel → Storage → Create → Blob, Private"

echo "== The coffee kiosk"
if (( NEW_TOKENS )) || ! has KIOSK_TOKEN || ! has PI_API_TOKEN; then
    kiosk=$(random); pi=$(random)
    put KIOSK_TOKEN "$kiosk"
    put PI_API_TOKEN "$pi"
    echo
    echo "  These go on the Pi (deploy/connect.sh asks for them) and in the SGA"
    echo "  password manager. They're shown this once:"
    echo
    echo "    HUB_TOKEN=$kiosk"
    echo "    HUB_API_TOKEN=$pi"
    echo
else
    echo "  ok  KIOSK_TOKEN, PI_API_TOKEN (--new-tokens replaces them, on the Pi too)"
fi
if [[ -n $PI_URL ]]; then
    put PI_API_URL "${PI_URL%/}" --no-sensitive
elif has PI_API_URL; then
    echo "  ok  PI_API_URL"
else
    echo "  note: PI_API_URL comes from deploy/connect.sh on the Pi; run this again with --pi-url"
fi

echo
if (( changes )); then
    vercel deploy --prod
    echo "Done. Sign in and open Settings: it lists anything still missing."
else
    echo "Nothing to change."
fi
