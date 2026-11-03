#!/bin/bash
# Makes a share link for one protected demo preview, so committee members can open it without a Vercel login.
#   ./scripts/demo-share-link.sh <preview url> [days]       copies the link to your clipboard (default 3 days)
#   ./scripts/demo-share-link.sh <preview url> [days] --file <path>   writes it to a private file instead
# The link only works for that one preview URL and stops working when it expires or the preview is removed.
# It is not printed, because anyone holding it can open the preview. Paste it into the message you send.
# Turns nothing off project-wide: Vercel Authentication stays on for everything else.
set -e
cd "$(dirname "$0")/.."
URL="${1:-}"; DAYS="${2:-3}"
if [ -z "$URL" ]; then echo "Usage: ./scripts/demo-share-link.sh <preview url> [days] [--file path]" >&2; exit 1; fi
case "$URL" in
  *firstandlastpickleball.co.uk*|*first-and-last-pickleball.vercel.app*|*-git-main-*|*first-and-last-pickleball-ollie-personal.vercel.app*)
    echo "Refusing: that looks like a live address, not a preview." >&2; exit 1 ;;
esac
HOST="${URL#https://}"; HOST="${HOST%%/*}"
OUT=$(mktemp); trap 'rm -f "$OUT"' EXIT
# Vercel allows one share link per preview and will not list it again. We keep the secret in a private
# file outside the repo, so a re-run can revoke the old link and make a fresh one.
STORE="$HOME/.config/pickleball-demo"; mkdir -p "$STORE"; chmod 700 "$STORE"
SAVED="$STORE/$HOST.secret"
if [ -s "$SAVED" ]; then
  (umask 077; printf '{"revoke":{"secret":"%s","regenerate":false}}' "$(cat "$SAVED")" > "$OUT.body")
  npx vercel api "/aliases/$HOST/protection-bypass" -X PATCH --input "$OUT.body" > /dev/null 2>&1 || true
  rm -f "$OUT.body" "$SAVED"; echo "Old share link revoked."
fi
npx vercel api "/aliases/$HOST/protection-bypass" -X PATCH -F ttl=$((DAYS*86400)) > "$OUT" 2>/dev/null || { echo "Vercel refused. If it says a link already exists, put the old secret in $SAVED and re-run." >&2; exit 1; }
LINK=$(python3 - "$OUT" "$HOST" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
secrets = [k for k, v in d.get('protectionBypass', {}).items() if v.get('scope') == 'shareable-link']
if not secrets: sys.exit(1)
print(secrets[-1])
PY
)
(umask 077; printf '%s' "$LINK" > "$SAVED")
LINK="https://$HOST/?_vercel_share=$LINK"
if [ "$3" = "--file" ] && [ -n "$4" ]; then
  (umask 077; printf '%s' "$LINK" > "$4"); echo "Share link written to $4"
else
  printf '%s' "$LINK" | pbcopy; echo "Share link copied to your clipboard (valid $DAYS days)."
fi
