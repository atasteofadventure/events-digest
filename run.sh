#!/bin/bash
REPO_DIR="$HOME/events-digest"
PORT=3847

cd "$REPO_DIR" || exit 1
git pull --quiet 2>/dev/null

LATEST=$(ls -t digests/*.html 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then
  echo "No digests found."
  exit 0
fi

FILENAME=$(basename "$LATEST")

if ! lsof -i :"$PORT" > /dev/null 2>&1; then
  node "$REPO_DIR/server.js" &
  disown
  sleep 1
fi

open "http://localhost:${PORT}/digests/${FILENAME}"
