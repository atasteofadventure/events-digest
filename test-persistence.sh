#!/bin/bash
# Lifecycle tests for the events-digest feedback server.
# Verifies: (1) it serves digests, (2) it is persistent by default,
# (3) the opt-in inactivity self-shutdown still works when configured.
set -u

REPO_DIR="$HOME/events-digest"
NODE="$(command -v node)"
PORT=38470            # test port, never the real 3847
PASS=0; FAIL=0

check() {
  if [ "$1" = "$2" ]; then
    echo "PASS: $3"; PASS=$((PASS+1))
  else
    echo "FAIL: $3 (expected '$2', got '$1')"; FAIL=$((FAIL+1))
  fi
}

wait_up() {
  for _ in $(seq 1 30); do
    curl -s -o /dev/null "http://localhost:$PORT/" && return 0
    sleep 0.1
  done
  return 1
}

is_up() { curl -s -o /dev/null -m 2 "http://localhost:$PORT/"; }

# --- Test 1: serves the index (HTTP 200) ---
DIGEST_PORT=$PORT "$NODE" "$REPO_DIR/server.js" >/tmp/test-persistence.out 2>&1 &
PID=$!
wait_up
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/")
check "$CODE" "200" "server serves index (200)"
kill -9 "$PID" 2>/dev/null

# --- Test 2: persistent by default (no self-shutdown when env unset) ---
DIGEST_PORT=$PORT "$NODE" "$REPO_DIR/server.js" >/tmp/test-persistence.out 2>&1 &
PID=$!
wait_up
sleep 1.5
if is_up; then UP=yes; else UP=no; fi
check "$UP" "yes" "default is persistent (still serving after idle)"
kill -9 "$PID" 2>/dev/null

# --- Test 3: opt-in inactivity shutdown still fires when configured ---
DIGEST_PORT=$PORT DIGEST_INACTIVITY_MS=400 "$NODE" "$REPO_DIR/server.js" >/tmp/test-persistence.out 2>&1 &
PID=$!
wait_up
sleep 1.2
if is_up; then DOWN=no; else DOWN=yes; fi
check "$DOWN" "yes" "DIGEST_INACTIVITY_MS triggers self-shutdown"
kill -9 "$PID" 2>/dev/null

echo "----"
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
