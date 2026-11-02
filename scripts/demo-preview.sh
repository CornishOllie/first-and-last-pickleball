#!/bin/bash
# Builds and deploys a Vercel PREVIEW of the committee demo from this folder. No git push, no production.
#   ./scripts/demo-preview.sh
# What it does:
#   1. node scripts/demo.mjs seed  (fresh made-up players and nights; demo.invalid accounts only)
#   2. vercel deploy (preview) with the cloud and demo switches passed to THIS deployment only:
#        build env:   PUBLIC_PLAY_CLOUD=on  PUBLIC_DEMO_MODE=on  PUBLIC_SUPABASE_URL  PUBLIC_SUPABASE_ANON_KEY
#        runtime env: DEMO_MODE=on  SUPABASE_URL  SUPABASE_SERVICE_ROLE_KEY
#      Nothing is added to the Vercel project settings, so the live site and every other deployment is untouched.
#   3. prints the preview URL.
# The service key sits on that preview (it is how demo sign-in works), so remove it after the meeting:
#   ./scripts/demo-preview-remove.sh <preview url>
# Demo sign-in uses verifyOtp, not email links, so Supabase redirect URLs do not matter and no email is sent.
# Keys are fetched here and handed over through the environment. They are never printed or put in the command line.
set -e
cd "$(dirname "$0")/.."

for a in "$@"; do
  case "$a" in
    --prod|--production|--target|--target=*|--prebuilt|--skip-domain)
      echo "Refusing: this script only makes preview deployments ($a is not allowed)." >&2; exit 1 ;;
  esac
done
if [ "$#" -gt 0 ]; then echo "Usage: ./scripts/demo-preview.sh   (takes no arguments)" >&2; exit 1; fi

REF=bybbgwppshsaehkozgnx
export SUPABASE_URL="https://$REF.supabase.co"

echo "Seeding demo data..."
node scripts/demo.mjs seed

KEYS=$(supabase projects api-keys --project-ref "$REF" -o json 2>/dev/null)
PUBLIC_SUPABASE_ANON_KEY=$(printf '%s' "$KEYS" | python3 -c "import sys,json; print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='anon'))")
SUPABASE_SERVICE_ROLE_KEY=$(printf '%s' "$KEYS" | python3 -c "import sys,json; print(next(k['api_key'] for k in json.load(sys.stdin) if k['name']=='service_role'))")
unset KEYS
export PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY
export PUBLIC_SUPABASE_URL="$SUPABASE_URL"
export PUBLIC_PLAY_CLOUD=on PUBLIC_DEMO_MODE=on DEMO_MODE=on

echo "Deploying a preview (this takes a minute or two)..."
# "-b NAME" and "-e NAME" with no value make the CLI read the value from the environment above.
# --target preview is explicit, so this can never become a production deployment.
URL=$(npx vercel deploy --target preview --yes \
  -b PUBLIC_PLAY_CLOUD -b PUBLIC_DEMO_MODE -b PUBLIC_SUPABASE_URL -b PUBLIC_SUPABASE_ANON_KEY \
  -e DEMO_MODE -e SUPABASE_URL -e SUPABASE_SERVICE_ROLE_KEY \
  -m purpose=committee-demo | grep -Eo 'https://[A-Za-z0-9.-]+\.vercel\.app' | tail -n 1)

case "$URL" in
  https://*.vercel.app) ;;
  *) echo "Deploy did not print a preview URL. Check 'npx vercel ls'." >&2; exit 1 ;;
esac

echo
echo "Preview: $URL"
echo "  Player page: $URL/me     Host tool: $URL/host"
echo "Previews on this account are behind Vercel login. To let the committee in without one, run:"
echo "  ./scripts/demo-share-link.sh $URL      (copies a share link to your clipboard)"
echo "After the meeting: ./scripts/demo-preview-remove.sh $URL"
