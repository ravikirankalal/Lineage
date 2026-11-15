#!/usr/bin/env bash
# Wait for GitHub's "Deploy to Firebase" run for a commit, then confirm the live site serves a new build.
# Usage: scripts/wait-deploy.sh <merge-commit-sha> [live-build-before-merge]
# Checks every 3 s (no local rebuild needed). Exit 0 when deployed, 1 on failure or timeout.
set -u
SHA=${1:?merge commit sha}
BEFORE=${2:-}
REPO=ravikirankalal/Lineage
SITE=https://lineage-d575c.web.app/
API="https://api.github.com/repos/$REPO/actions/workflows/firebase-deploy.yml/runs?head_sha=$SHA&per_page=1"
live() { curl -s "$SITE?x=$RANDOM$RANDOM" | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1; }
start=$(date +%s)
while :; do
  read -r status conclusion < <(curl -s "$API" | python3 -c "import sys,json;r=json.load(sys.stdin).get('workflow_runs',[]);print(*(r[0]['status'],r[0]['conclusion']) if r else ('waiting','none'))")
  t=$(( $(date +%s) - start ))
  if [ "$status" = completed ]; then
    [ "$conclusion" = success ] || { echo "deploy $conclusion after ${t}s"; exit 1; }
    now=$(live)
    if [ -n "$BEFORE" ] && [ "$now" = "$BEFORE" ]; then
      echo "deploy finished after ${t}s but the live site still serves $now (no app change, or CDN catching up)"
    else
      echo "live after ${t}s: $now"
    fi
    exit 0
  fi
  [ $t -gt 600 ] && { echo "timed out ($status)"; exit 1; }
  sleep 3
done
