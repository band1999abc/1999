#!/usr/bin/env bash
# Integration test for diary / live / flyer API endpoints.
#
# Requires:
#   - Local dev server running on http://localhost:5000 (python3 server.py)
#   - ADMIN_PASSWORD env var set to the admin password
#
# Usage:
#   ADMIN_PASSWORD=<pw> bash scripts/test_api.sh
#
# Exits 0 if all checks pass, non-zero otherwise.

set -uo pipefail
BASE="${API_BASE:-http://localhost:5000}"
COOKIE_JAR=$(mktemp)
FAIL=0
PASS_COUNT=0

# ── Helpers ───────────────────────────────────────────────────────────────────

check() {
  local label="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -qF "$expected"; then
    echo "  ✓ $label"
    PASS_COUNT=$((PASS_COUNT+1))
  else
    echo "  ✗ $label"
    echo "      expected substring: $expected"
    echo "      got: $(echo "$actual" | head -c 200)"
    FAIL=$((FAIL+1))
  fi
}

check_code() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  ✓ $label"
    PASS_COUNT=$((PASS_COUNT+1))
  else
    echo "  ✗ $label  (expected HTTP $expected, got $actual)"
    FAIL=$((FAIL+1))
  fi
}

# ── 1. Auth ───────────────────────────────────────────────────────────────────
echo ""
echo "=== /api/auth ==="

R=$(curl -s "$BASE/api/auth")
check "GET /api/auth unauthenticated → ok:false" '"ok"' "$R"

R=$(curl -s -c "$COOKIE_JAR" -X POST "$BASE/api/auth" \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"login\",\"password\":\"$ADMIN_PASSWORD\"}")
check "POST /api/auth login → ok:true" '"ok": true' "$R"

R=$(curl -s -b "$COOKIE_JAR" "$BASE/api/auth")
check "GET /api/auth authed → ok:true" '"ok": true' "$R"

# ── 2. Diary — unauthenticated list ──────────────────────────────────────────
echo ""
echo "=== /api/diary (unauthenticated) ==="
R=$(curl -s "$BASE/api/diary")
check "GET /api/diary → array" '[' "$R"

if echo "$R" | python3 -c "
import sys, json
posts = json.load(sys.stdin)
bad = [p for p in posts if p.get('status') != 'published']
if bad: print('FAIL'); sys.exit(1)
print('OK')
" 2>/dev/null | grep -q OK; then
  echo "  ✓ GET /api/diary unauth → only published items"
  PASS_COUNT=$((PASS_COUNT+1))
else
  echo "  ✗ GET /api/diary unauth → non-published items exposed"
  FAIL=$((FAIL+1))
fi

# ── 3. Diary CRUD ─────────────────────────────────────────────────────────────
echo ""
echo "=== /api/diary CRUD (authenticated) ==="

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/diary" \
  -H 'Content-Type: application/json' -d '{"title":"x"}')
check_code "POST /api/diary unauthed → 401" "401" "$CODE"

R=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE/api/diary" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Test Post","body":"body text","date":"2026-07-07","status":"draft"}')
check "POST /api/diary create draft → has id" '"id"' "$R"
DIARY_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
echo "    diary_id=$DIARY_ID"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" "$BASE/api/diary/$DIARY_ID")
check_code "GET /api/diary/:id authed → 200" "200" "$CODE"

CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/diary/$DIARY_ID")
check_code "GET /api/diary/:id unauthed draft → 404" "404" "$CODE"

R=$(curl -s -b "$COOKIE_JAR" -X PUT "$BASE/api/diary/$DIARY_ID" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Updated Post","status":"published"}')
check "PUT /api/diary/:id → updated title" '"Updated Post"' "$R"

CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/diary/$DIARY_ID")
check_code "GET /api/diary/:id unauthed published → 200" "200" "$CODE"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$BASE/api/diary/$DIARY_ID" \
  -H 'Content-Type: application/json' -d '{"title":"hack"}')
check_code "PUT /api/diary/:id unauthed → 401" "401" "$CODE"

R=$(curl -s -b "$COOKIE_JAR" -X DELETE "$BASE/api/diary/$DIARY_ID")
check "DELETE /api/diary/:id → ok" '"ok"' "$R"

CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/diary/$DIARY_ID")
check_code "GET /api/diary/:id after delete → 404" "404" "$CODE"

# Scheduled post validation
R=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE/api/diary" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Sched","status":"scheduled"}')
check "POST /api/diary scheduled without scheduledAt → 400 error" '"error"' "$R"

R=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE/api/diary" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Sched","status":"scheduled","scheduledAt":"2099-12-31T23:59"}')
check "POST /api/diary scheduled with valid scheduledAt → has id" '"id"' "$R"
SCHED_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
[ -n "$SCHED_ID" ] && curl -s -b "$COOKIE_JAR" -X DELETE "$BASE/api/diary/$SCHED_ID" >/dev/null

# ── 4. Live CRUD ──────────────────────────────────────────────────────────────
echo ""
echo "=== /api/live CRUD (authenticated) ==="
R=$(curl -s "$BASE/api/live")
check "GET /api/live → array" '[' "$R"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/live" \
  -H 'Content-Type: application/json' -d '{"venue":"x"}')
check_code "POST /api/live unauthed → 401" "401" "$CODE"

R=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE/api/live" \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-08-15","venue":"Test Hall","open":"18:00","start":"19:00","ticket":"https://t.co","status":"draft"}')
check "POST /api/live create → has id" '"id"' "$R"
LIVE_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
echo "    live_id=$LIVE_ID"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" "$BASE/api/live/$LIVE_ID")
check_code "GET /api/live/:id authed → 200" "200" "$CODE"

CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/live/$LIVE_ID")
check_code "GET /api/live/:id unauthed draft → 404" "404" "$CODE"

R=$(curl -s -b "$COOKIE_JAR" -X PUT "$BASE/api/live/$LIVE_ID" \
  -H 'Content-Type: application/json' \
  -d '{"venue":"New Hall","status":"published"}')
check "PUT /api/live/:id → updated venue" '"New Hall"' "$R"

CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/live/$LIVE_ID")
check_code "GET /api/live/:id unauthed published → 200" "200" "$CODE"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/api/live/$LIVE_ID")
check_code "DELETE /api/live/:id unauthed → 401" "401" "$CODE"

# ── 5. Flyer ──────────────────────────────────────────────────────────────────
echo ""
echo "=== /api/flyer/:id ==="
TINY_PNG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/flyer/$LIVE_ID")
check_code "GET /api/flyer/:id before upload → 404" "404" "$CODE"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/flyer/$LIVE_ID" \
  -H 'Content-Type: application/json' \
  -d "{\"dataUrl\":\"$TINY_PNG\"}")
check_code "POST /api/flyer/:id unauthed → 401" "401" "$CODE"

R=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE/api/flyer/$LIVE_ID" \
  -H 'Content-Type: application/json' \
  -d "{\"dataUrl\":\"$TINY_PNG\"}")
check "POST /api/flyer/:id upload → slotId" '"slotId"' "$R"
SLOT_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin).get('slotId',''))" 2>/dev/null || echo "")
echo "    slot_id=$SLOT_ID"

CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/flyer/$LIVE_ID")
check_code "GET /api/flyer/:id (default slot, published live) → 200" "200" "$CODE"

CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/flyer/$LIVE_ID?s=$SLOT_ID")
check_code "GET /api/flyer/:id?s=SLOT → 200" "200" "$CODE"

CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/flyer/$LIVE_ID?s=nonexistent")
check_code "GET /api/flyer/:id?s=bad → 404" "404" "$CODE"

R=$(curl -s -b "$COOKIE_JAR" -X DELETE "$BASE/api/flyer/$LIVE_ID?s=$SLOT_ID")
check "DELETE /api/flyer/:id?s=SLOT → ok" '"ok"' "$R"

CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/flyer/$LIVE_ID")
check_code "GET /api/flyer/:id after slot delete → 404" "404" "$CODE"

R=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE/api/flyer/$LIVE_ID" \
  -H 'Content-Type: application/json' -d "{\"dataUrl\":\"$TINY_PNG\"}")
check "POST /api/flyer/:id second upload → slotId" '"slotId"' "$R"

R=$(curl -s -b "$COOKIE_JAR" -X DELETE "$BASE/api/flyer/$LIVE_ID")
check "DELETE /api/flyer/:id (all) → images key present" '"images"' "$R"
IMAGES_COUNT=$(echo "$R" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('images',[])))" 2>/dev/null || echo "?")
if [ "$IMAGES_COUNT" = "0" ]; then
  echo "  ✓ images=[] after all-delete"
  PASS_COUNT=$((PASS_COUNT+1))
else
  echo "  ✗ images not empty after all-delete (count=$IMAGES_COUNT)"
  FAIL=$((FAIL+1))
fi

# Auth gate: draft live → unauthed cannot see flyer
R=$(curl -s -b "$COOKIE_JAR" -X PUT "$BASE/api/live/$LIVE_ID" \
  -H 'Content-Type: application/json' -d '{"status":"draft"}')
R=$(curl -s -b "$COOKIE_JAR" -X POST "$BASE/api/flyer/$LIVE_ID" \
  -H 'Content-Type: application/json' -d "{\"dataUrl\":\"$TINY_PNG\"}")
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/flyer/$LIVE_ID")
check_code "GET /api/flyer/:id unauthed draft live → 404" "404" "$CODE"

# Cleanup test live
curl -s -b "$COOKIE_JAR" -X DELETE "$BASE/api/live/$LIVE_ID" >/dev/null

# ── 6. Non-resource endpoints not caught by [resource].js ────────────────────
echo ""
echo "=== Other endpoints (weather, analytics) ==="

CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/weather")
check_code "GET /api/weather → 200" "200" "$CODE"

VID="$(python3 -c "import uuid; print(uuid.uuid4())")"
SID="$(python3 -c "import uuid; print(uuid.uuid4())")"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/analytics" \
  -H 'Content-Type: application/json' \
  -d "{\"visitor_id\":\"$VID\",\"session_id\":\"$SID\",\"event\":\"page_view\",\"page\":\"/\"}")
# Server returns 200 or 204; both are success
if [ "$CODE" = "200" ] || [ "$CODE" = "204" ]; then
  echo "  ✓ POST /api/analytics → $CODE (success)"
  PASS_COUNT=$((PASS_COUNT+1))
else
  echo "  ✗ POST /api/analytics → $CODE (expected 200 or 204)"
  FAIL=$((FAIL+1))
fi

CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" \
  "$BASE/api/analytics?start=2026-07-07&end=2026-07-07")
check_code "GET /api/analytics authed → 200" "200" "$CODE"

CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "$BASE/api/analytics?start=2026-07-07&end=2026-07-07")
check_code "GET /api/analytics unauthed → 401" "401" "$CODE"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  Passed: $PASS_COUNT  Failed: $FAIL"
echo "══════════════════════════════════════════"
rm -f "$COOKIE_JAR"
exit $FAIL
