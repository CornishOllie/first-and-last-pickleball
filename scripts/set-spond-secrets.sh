#!/bin/bash
# Sets up the Spond connection for the play night tool.
# Run this yourself in a normal Terminal window (not inside Claude Code), from the project folder:
#     cd ~/personal-projects/first-and-last-pickleball && ./scripts/set-spond-secrets.sh
# Nothing you type is shown on screen or sent anywhere except Vercel's private settings and a private
# file on this Mac (~/.config/play-night/spond.env, readable only by you).
set -e
cd "$(dirname "$0")/.."

read -r -p "Spond login email: " SPOND_EMAIL
read -r -s -p "Spond password: " SPOND_PASSWORD; echo
read -r -s -p "Choose a LIST CODE for the tool, at least 8 characters (people type this once per night): " PLAY_LIST_CODE; echo
if [ "${#PLAY_LIST_CODE}" -lt 8 ]; then echo "That is too short. Run it again with at least 8 characters."; exit 1; fi
read -r -p "Only show Spond groups whose name contains [First & Last]: " GROUP
GROUP="${GROUP:-First & Last}"

umask 077
mkdir -p "$HOME/.config/play-night"
{
  printf 'SPOND_EMAIL=%q\n' "$SPOND_EMAIL"
  printf 'SPOND_PASSWORD=%q\n' "$SPOND_PASSWORD"
  printf 'PLAY_LIST_CODE=%q\n' "$PLAY_LIST_CODE"
  printf 'SPOND_GROUP_MATCH=%q\n' "$GROUP"
} > "$HOME/.config/play-night/spond.env"

set_var() { # name value
  npx vercel env rm "$1" production --yes >/dev/null 2>&1 || true
  printf '%s' "$2" | npx vercel env add "$1" production --sensitive >/dev/null
  echo "  set $1"
}
echo "Saving to Vercel..."
set_var SPOND_EMAIL "$SPOND_EMAIL"
set_var SPOND_PASSWORD "$SPOND_PASSWORD"
set_var PLAY_LIST_CODE "$PLAY_LIST_CODE"
set_var SPOND_GROUP_MATCH "$GROUP"
echo
echo "Done. Tell Claude it is finished. Remember the list code: you will type it in the tool the first time each night."
