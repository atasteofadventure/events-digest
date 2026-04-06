#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "[]" > feedback/responses.json

SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  echo "[]" > feedback/responses.json
}
trap cleanup EXIT

echo "Starting server..."
node server.js &
SERVER_PID=$!
sleep 1

echo ""
echo "Test 1: Root returns digest list..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3847/)
[ "$STATUS" = "200" ] && echo "  PASS" || { echo "  FAIL: got $STATUS"; exit 1; }

echo "Test 2: POST feedback returns ok..."
RESP=$(curl -s -X POST http://localhost:3847/feedback \
  -H "Content-Type: application/json" \
  -d '{"event_id":"test_1","signal":"thumbs_up","timestamp":"2026-04-12T18:00:00Z"}')
echo "$RESP" | grep -q '"ok":true' && echo "  PASS" || { echo "  FAIL: $RESP"; exit 1; }

echo "Test 3: Feedback persisted to file..."
grep -q "test_1" feedback/responses.json && echo "  PASS" || { echo "  FAIL"; exit 1; }

echo "Test 4: Second feedback appends..."
curl -s -X POST http://localhost:3847/feedback \
  -H "Content-Type: application/json" \
  -d '{"event_id":"test_2","signal":"thumbs_down","timestamp":"2026-04-12T18:05:00Z"}' > /dev/null
COUNT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('feedback/responses.json','utf8')).length)")
[ "$COUNT" = "2" ] && echo "  PASS" || { echo "  FAIL: expected 2, got $COUNT"; exit 1; }

echo "Test 5: Unknown path returns 404..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3847/nonexistent)
[ "$STATUS" = "404" ] && echo "  PASS" || { echo "  FAIL: got $STATUS"; exit 1; }

echo ""
echo "All tests passed!"
