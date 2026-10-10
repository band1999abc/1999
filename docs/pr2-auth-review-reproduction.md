# PR #2: F1–F6 reproduction and regression conditions

Base: `4850d50b5f971f434be8f2b97f8cea4fb30863f8`.
All credentials, storage and media are synthetic. No production endpoints.

## Saved before application edits

- F1: revocation GET returns HTTP errors, broken JSON, `error` with `result:null`,
  `error` with `result:"OK"`, missing `result`, arrays or null. Expect protected
  reads/mutations 503 and zero data writes; invalid credentials remain 401.
- F2: same failures on revocation SET, plus `result:null` without an error.
  Expect logout 503 with explicit unconfirmed revocation. Normal successful SET
  must produce logout 200 followed by replay 401.
- F3: conflicting Bearer/Cookie, including real NBSP and empty Bearer. Count
  header reads and return a different token on a second read. Expect exactly
  one selection and matching revocation hash in every handler.
- F4: warm draft jacket/flyer with a valid token using actual browser HTTP cache
  (no Playwright routing, which disables that cache). Then request anonymously.
  Expect 404 and private responses `private, no-store`. Also warm a simulated
  legacy public-cache response, log out, and verify cache migration.
- F5: abort only `/admin.js` on every management page. Expect no management
  requests, hidden/inert controls and a standalone retry explanation.
- F6: correctly sign synthetic payloads with missing/null/string/non-finite/
  malformed/expired `exp`. Expect 401 and no mutation. Existing numeric-exp
  tokens, including the legacy no-member payload, must remain valid.

Commands: `node --test scripts/test-auth-review-api.mjs` and
`node --test scripts/test-auth-review-browser.mjs`.
Browser dependencies use the preinstalled Playwright driver and Chromium.
Baseline and final summaries are recorded below after each execution.

## Before (unmodified application at the base commit)

- API regression: 0/4 pass, 4 fail. Protected private GET classified an outage
  as 401; failed logout returned 200; Analytics read Authorization twice;
  a signed missing-exp payload was accepted.
- Explicit F1 probe: `error + result:null` returned Auth GET 200 and Diary
  POST 201, with one **mock** data write (expected 503 and zero).
- Browser regression: 0/12 pass, 12 fail. Private image had public cache headers;
  all 10 missing-script cases failed the request/inert/retry contract; failed
  logout navigated away instead of displaying unconfirmed revocation.

## After: final candidate

The final test files were also copied unchanged into a temporary archive of
the base commit. API: 0/4 before -> 4/4 after; browser: 0/12 before -> 12/12 after.
The initial reproduction conditions above were saved before application edits.

| Suite | Result |
| --- | --- |
| New F1/F2/F3/F6 API groups | 4/4 passed |
| Existing session + public surface groups | 5/5 passed |
| New F4/F5 + failed-logout browser groups | 12/12 passed |
| Existing management gate responses | 70/70 passed |
| Gate cache migration | v34 -> v35; admin.js v9, admin.css v18 passed |
| Existing public browser audit | Passed: Music/Diary error/retry states, two tracks and playback/seek/Lyrics, flyer keyboard/focus, nine screen widths and public screens, SW migration and internal-file cache removal |

F1 covers network, HTTP 503, malformed JSON, error+null, error+OK, missing
result, array/null bodies, and false/zero/one/object/array result values.
For each of these 13 modes: six management GETs returned 503; all 25 protected
mutation routes returned 503 with valid credentials or 401 for invalid Bearer
plus valid Cookie; mock data writes = 0. Public lists returned 200 and only the
published/enabled fixture record.

F2: nine failed registration modes returned 503 with expired Cookie and
revocationConfirmed=false; after recovery the retained token could still return
200, correctly indicating unconfirmed revocation. Normal Bearer/Cookie logout
returned 200 and replay returned 401; private detail returned 404. The client
removes its local token, locks management access while logout is pending, and
shows an unconfirmed-revocation warning rather than claiming success.

F3: 25 combinations of absent/valid/invalid/revoked/expired Bearer and Cookie,
plus 12 targeted cases, across nine handler targets. Header getter count = 1;
signature/expiry/denylist hash use that same selected credential. Sixteen real
HTTP malformed/empty Bearer cases against Auth/Analytics/Insights/Milestones
returned 401 despite valid Cookie.

| Credentials | Selected | Expected / actual management status |
| --- | --- | --- |
| Valid Bearer + valid Cookie | Bearer | 200 / 200 |
| Invalid Bearer + valid Cookie | Bearer | 401 / 401 |
| Revoked Bearer + valid Cookie | Bearer | 401 / 401 |
| Valid Bearer + revoked Cookie | Bearer | 200 / 200 |
| Valid Cookie only | Cookie | 200 / 200 |
| Valid Bearer only | Bearer | 200 / 200 |
| No credential | None | 401 / 401 |
| Selected valid credential, unavailable revocation lookup | Same selected credential | 503 / 503 |

Public list/detail fallbacks intentionally remain 200 for public records and
404 for non-public records, instead of granting management access.

F4: actual browser HTTP cache, with NO Playwright request routing. Draft and
scheduled jackets/flyers: authenticated 200 private,no-store; subsequent
anonymous retrieval during auth-storage outage: 404. Published media permits
public cache. A deliberately simulated legacy public-cache private image
returned a cached anonymous 200 before migration; the media=v2 reference
returned 404 without using that legacy entry. Normal logout's Clear-Site-Data
cache directive also removed the legacy entry in the tested Chromium.

F5: all ten management screens with admin.js blocked: management/auth requests
= 0, roots hidden/inert, keyboard/focus denied. Restoring the script and retrying
recovered the management UI only after successful auth. Existing 70 responses
include 401, 500, 503, network, invalid JSON, false-ok, and successful 200.

F6: 14 malformed/expired expiry cases returned 401 with zero writes, including
missing, null, string, NaN-equivalent, infinity, array, boolean, object, zero,
negative, expired, unsafe range, invalid Date range and fractional milliseconds.
Canonical new tokens and legacy numeric-exp-only tokens remained accepted;
normal login returned 200.

## Remaining limits / delivery

- Safari/Firefox and real CDN behavior were not tested. Already distributed
  bytes cannot be remotely erased on every browser. Versioned references avoid
  legacy cache reuse in updated app pages; Clear-Site-Data is supplementary
  for supporting browsers, not a universal purge guarantee.
- Failed revocation is explicitly unconfirmed, not a successful logout.
  A copied token can remain usable after storage recovers until revoked/expired.
- No real storage, real authentication, production business data, deployment,
  merge, secrets or integration/settings mutation was used.
- Dedicated checkout: .local/pr2-worktree; branch: fix/production-audit-eight.
- No push / PR update: read-only Vercel project metadata returned 403, so the
  production-branch safety check could not be completed. Do not infer that
  pushing this branch is safe for production from this local test report.

## Changed files in the fix commit

```
admin-bootstrap.js
admin.js
api/_auth.js
api/auth.js
api/analytics.js
api/insights.js
api/milestones.js
api/[resource]/[id].js
api/afterhours-pages.js
diary-admin.js
live-admin.js
music-admin.js
messages-admin.js
weather-phrases-admin.js
insights.js
milestones.js
live.js
music.js
track.js
live.html
music.html
track.html
public-assets.json
sw.js
templates/afterhours.html
templates/afterhours-analytics.html
templates/afterhours-diary.html
templates/afterhours-insights.html
templates/afterhours-live.html
templates/afterhours-members.html
templates/afterhours-messages.html
templates/afterhours-milestones.html
templates/afterhours-music.html
templates/afterhours-weather-phrases.html
templates/login.html
scripts/auth-review-fixture.mjs
scripts/test-auth-review-api.mjs
scripts/test-auth-review-browser.mjs
scripts/test-auth-gate.mjs
scripts/test-audit-browser.mjs
docs/pr2-auth-review-reproduction.md
```
