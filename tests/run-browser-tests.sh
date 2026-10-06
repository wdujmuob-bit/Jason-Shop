#!/bin/bash
# Headless mobile-Chrome tests. Needs Google Chrome (CHROME_PATH) and `npm install` in tests/.
# usage: bash tests/run-browser-tests.sh [legacy|e2e|stage2|all|<file> <mock>]
# The AI is always mocked (fake api.openai.com) — no paid calls, no real key.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
export TEST_OUT="${TEST_OUT:-/tmp/jason-shop-tests}"
mkdir -p "$TEST_OUT"

stop_all(){ fuser -k 3000/tcp 3999/tcp 8080/tcp >/dev/null 2>&1; sleep 0.4; }

run_one(){ # <test file> <mock file>
  stop_all
  (cd "$ROOT" && python3 -m http.server 8080 >"$TEST_OUT/http.log" 2>&1 &)
  (cd "$HERE/legacy" && OPENAI_API_KEY=sk-test node "$2" >"$TEST_OUT/mock.log" 2>&1 &)
  sleep 1.5
  echo "=== $1 (mock: $(basename "$2")) ==="
  (cd "$HERE" && timeout 900 node "$1"); local rc=$?
  stop_all
  return $rc
}

FAIL=0
case "${1:-all}" in
  legacy|all)
    run_one legacy/test1.js "$HERE/legacy/mock2.js" || FAIL=1
    run_one legacy/test2.js "$HERE/legacy/mock2.js" || FAIL=1
    run_one legacy/test3.js "$HERE/legacy/mock3.js" || FAIL=1
    run_one legacy/test4.js "$HERE/legacy/mock4.js" || FAIL=1
    ;;&
  e2e|all)
    run_one e2e/stage1.test.js "$HERE/legacy/mock4.js" || FAIL=1
    ;;&
  e2e|stage2|all)
    run_one e2e/stage2.test.js "$HERE/legacy/mock4.js" || FAIL=1
    ;;
  legacy|e2e|stage2|all) ;;
  *) run_one "$1" "$HERE/legacy/${2:-mock4.js}" || FAIL=1 ;;
esac
[ $FAIL = 0 ] && echo "ALL BROWSER SUITES PASSED" || echo "SOME BROWSER SUITES FAILED"
exit $FAIL
