#!/bin/bash
# NYC Events Digest - Permanent cron runner
# Invokes Claude Code CLI to generate the weekly digest

# launchd runs jobs with a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin) that
# excludes Homebrew (/opt/homebrew/bin -> node) and the user bin dir
# (~/.local/bin -> claude). Set an explicit PATH so the scheduled run finds
# both, exactly as an interactive shell would. Without this the job fails with
# "claude: command not found" / "node: command not found".
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO_DIR="$HOME/events-digest"
PORT=3847
TODAY=$(date +%Y-%m-%d)

# Skip if today's digest already exists
if ls "$REPO_DIR/digests/${TODAY}"*.html 1>/dev/null 2>&1; then
  echo "Digest for $TODAY already exists. Skipping."
  exit 0
fi

# Check if Chrome is running (needed for browser scraping)
if ! pgrep -x "Google Chrome" > /dev/null 2>&1; then
  echo "Chrome is not running. Skipping digest generation."
  exit 1
fi

# Run Claude Code in print mode with Chrome integration
cd "$REPO_DIR"
claude -p --chrome --permission-mode auto \
  "Read ~/events-digest/prompt.md and execute every step. Use Chrome browser tools as primary scraper. Attempt EVERY enabled source. Collect all events first, then rank and select top 20 weekday + 20 weekend. Generate HTML digest and save to digests/. Then start the feedback server on port 3847 if not running, and open the digest in the browser." \
  2>/tmp/events-digest-claude.log

# The feedback server is an always-on service owned by the
# com.events-digest.server launchd job (RunAtLoad + KeepAlive), so it does not
# need to be started here. Give it a moment in case launchd is still bringing
# it up after a reboot.
if ! lsof -i :"$PORT" > /dev/null 2>&1; then
  echo "Note: server not on :$PORT yet (com.events-digest.server should start it)."
  sleep 2
fi

# Open latest digest
LATEST=$(ls -t "$REPO_DIR/digests/"*.html 2>/dev/null | head -1)
if [ -n "$LATEST" ]; then
  open "http://localhost:${PORT}/digests/$(basename "$LATEST")"
fi
