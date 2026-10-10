#!/usr/bin/env bash
# Commit changed files in store/data and push, retrying if the app pushed in between.
set -euo pipefail
cd store
git config user.name "healthy-football-bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add data
if git diff --cached --quiet; then
  echo "Keine Datenänderungen."
  exit 0
fi
git commit -m "$1"
for attempt in 1 2 3 4; do
  if git pull --rebase --quiet && git push --quiet; then
    exit 0
  fi
  echo "Push fehlgeschlagen (Versuch $attempt), neuer Versuch …"
  sleep $((attempt * 5))
done
exit 1
