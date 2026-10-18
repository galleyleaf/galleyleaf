#!/usr/bin/env bash
# Runs the UI checks in a real browser against a mocked Firebase.
# Requires: python3 and playwright-cli. Usage: tests/run-ui-tests.sh  (PORT=8765 by default)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8765}"
BASE="http://localhost:$PORT"
SESSION="book-tests"

command -v playwright-cli >/dev/null || { echo "playwright-cli is not installed."; exit 1; }

cd "$ROOT"
python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER=$!
trap 'playwright-cli -s="$SESSION" close >/dev/null 2>&1 || true; kill "$SERVER" 2>/dev/null || true' EXIT
sleep 1

playwright-cli -s="$SESSION" open "$BASE/" >/dev/null
playwright-cli -s="$SESSION" resize 390 844 >/dev/null

OUTPUT="$(playwright-cli -s="$SESSION" run-code "$(sed "s#__BASE__#$BASE#g" tests/ui-checks.js)" 2>&1 || true)"

RESULT="$(printf '%s\n' "$OUTPUT" | sed -n '/^### Result/{n;p;}')"
if [ -z "$RESULT" ]; then
  echo "The checks didn't run:"
  printf '%s\n' "$OUTPUT" | sed -n '/^### Error/,/^###/p'
  exit 1
fi

REPORT="$(printf '%s' "$RESULT" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read()))')"
echo "$REPORT"
PASSED=$(grep -c '^PASS' <<<"$REPORT" || true)
FAILED=$(grep -c '^FAIL' <<<"$REPORT" || true)
echo
echo "$PASSED passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
