#!/bin/bash
# Switches the shared play night record (database, host sign-in, player stats) on or off for the live site.
#   ./scripts/play-cloud.sh on     then push / redeploy
#   ./scripts/play-cloud.sh off    then push / redeploy
# Needs the Supabase CLI and Vercel CLI logged in. Never prints keys.
set -e
cd "$(dirname "$0")/.."
REF=bybbgwppshsaehkozgnx
URL="https://$REF.supabase.co"

rm_var() { npx vercel env rm "$1" "$2" --yes >/dev/null 2>&1 || true; }
add_cfg() { rm_var "$1" "$2"; npx vercel env add "$1" "$2" --type config --value "$3" --yes >/dev/null; echo "  set $1 ($2)"; }
add_secret() { rm_var "$1" "$2"; printf '%s' "$3" | npx vercel env add "$1" "$2" --sensitive >/dev/null; echo "  set $1 ($2, hidden)"; }

case "$1" in
  on)
    KEYS=$(supabase projects api-keys --project-ref "$REF" -o json 2>/dev/null)
    ANON=$(printf '%s' "$KEYS" | python3 -c "import sys,json; print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='anon'))")
    SVC=$(printf '%s' "$KEYS" | python3 -c "import sys,json; print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='service_role'))")
    for env in production preview; do
      add_cfg PUBLIC_PLAY_CLOUD "$env" on
      add_cfg PUBLIC_SUPABASE_URL "$env" "$URL"
      add_cfg PUBLIC_SUPABASE_ANON_KEY "$env" "$ANON"
    done
    # The server-side keys are for production only. Preview builds can not create accounts.
    add_cfg SUPABASE_URL production "$URL"
    add_secret SUPABASE_SERVICE_ROLE_KEY production "$SVC"
    echo "On. Push or redeploy for it to take effect."
    ;;
  off)
    for env in production preview; do
      for n in PUBLIC_PLAY_CLOUD PUBLIC_SUPABASE_URL PUBLIC_SUPABASE_ANON_KEY; do rm_var "$n" "$env"; done
    done
    rm_var SUPABASE_URL production
    rm_var SUPABASE_SERVICE_ROLE_KEY production
    echo "Off. Push or redeploy for it to take effect."
    ;;
  *) echo "Usage: ./scripts/play-cloud.sh on|off"; exit 1 ;;
esac
