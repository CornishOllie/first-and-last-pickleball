#!/bin/bash
# Removes one demo preview deployment so the service key does not stay on a live URL after the meeting.
#   ./scripts/demo-preview-remove.sh https://first-and-last-pickleball-xxxx-ollie-personal.vercel.app
# Refuses anything that looks like the live site.
set -e
cd "$(dirname "$0")/.."
URL="$1"
if [ -z "$URL" ]; then echo "Usage: ./scripts/demo-preview-remove.sh <preview url>" >&2; exit 1; fi
case "$URL" in
  *firstandlastpickleball.co.uk*|*first-and-last-pickleball.vercel.app*|*-git-main-*|*first-and-last-pickleball-ollie-personal.vercel.app*)
    echo "Refusing: that looks like a live address, not a preview." >&2; exit 1 ;;
esac
# A production deployment's own URL is also refused: check the target first.
TARGET=$(npx vercel inspect "$URL" 2>&1 | awk '$1=="target"{print $2}')
if [ "$TARGET" != "preview" ]; then echo "Refusing: target is '$TARGET', not preview." >&2; exit 1; fi
npx vercel remove "$URL" --yes
