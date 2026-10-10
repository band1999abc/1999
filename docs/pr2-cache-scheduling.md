# PR #2: F4 image caching and F1 scheduled publication

## Scope

Changes are relative to dedfeb5cd5cd1afcbc37ba7ae1ff1182cfce5858.
Only reversible media caching, publication during an unavailable revocation
lookup, their synthetic fixtures and regression checks are changed.
No production credentials/data, deployment, settings mutation or remote write
is part of this work.

## F4

Jackets and flyers use `private, no-store` even while published. Their URLs,
including unversioned URLs, `?media=v2` and flyer slot parameters, are unchanged.
Member photos remain permanently public and retain their existing cache policy.

The updated worker fetches same-origin jacket/flyer GET/HEAD requests with
`cache: no-store`, without changing credentials or authorization headers. It
does not read or store API media in Cache Storage, and has no offline fallback
for these images. Its cache generation change deletes old Cache Storage entries.
That deletion is NOT an HTTP-cache purge.

Logout's existing `Clear-Site-Data: "cache"` is supplementary browser-dependent
cleanup, not the mechanism that makes subsequent acquisitions enforce status.
Clients without the new worker can retain old, already distributed HTTP-cache
entries until expiry or browser-specific cleanup. Neither this change nor a
server can universally erase downloaded images or pixels already displayed.

The new browser test uses real Chromium HTTP caching, without Playwright routing:
published image decodes -> same record becomes draft -> same anonymous URL
returns 404 and does not display -> republished image decodes again.
The first commit contains the F1 scenario and two no-worker media tests (three
tests total). The dependent second commit brings the suite to nine tests:
one F1 test, two no-worker media tests, two running v35-to-v36 migrations,
two retained-cache failure tests, one Node wait-failure test and one Playwright
timeout-argument test. The real controlling worker's CACHE value is queried
before and after migration; creating a cache namespace alone is not sufficient.
No manual registration.update() is used: the fixture reuses the existing
application registration code and reloads the page.

The Node waiter awaits each observation and has a hard timeout, including when
an observation never resolves. Retained v35 entries must produce WAIT_TIMEOUT,
not success, even after v36 controls the page. Deletion failure is injected only
into the loopback worker response; the application worker file is not modified.

## F1

A request whose selected token's revocation lookup is unavailable does not run
scheduled promotion at all. Both list and detail routes retain stored statuses:
already-published reads remain 200; overdue scheduled details remain 404 and
are excluded from public lists. Management authentication stays false.

Healthy lookups and ordinary anonymous reads retain scheduled publication.
An anonymous request has no session token to check: this change does not add a
global storage-health probe or suspend anonymous publication.

Tests use overdue records, real handler code and synthetic accepted SET/EVAL
commands. Across 112 signed scenarios, healthy requests perform one save;
each of 13 revocation failure modes performs zero saves. Four normal anonymous
list/detail scenarios each perform one save. Saved payloads are inspected to
ensure the scheduled record really changes to published.

## Reproduction and verification

`node --test scripts/test-cache-scheduling.mjs`

Run with exclusively dummy application environment values (the script sanitizes
its process and its child), an installed Playwright module and Chromium binary.
Only the loopback HTTP fixture and `.invalid` mocked storage are used.

### Clean checkout prerequisites

- Node 24.x, as required by package.json, and Git.
- Install the locked application dependencies in the isolated checkout with
  `npm ci --ignore-scripts`. The handlers statically import `@vercel/blob`.
- Supply an existing Playwright 1.40 module and Chromium executable through
  `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH`; Playwright is not an application
  dependency. Do not change package.json or the lockfile to run these tests.
- Start every test process with `env -i`, retaining only PATH, a temporary HOME,
  and the two browser paths. No real application credentials are needed.
- Run from the checkout root. The first commit's three-test suite has no old
  Git-object dependency. The second commit must include the first commit's
  application changes, dependencies and fixtures.

### Git object prerequisite for the nine-test suite

The exact old worker is read using Git from
dedfeb5cd5cd1afcbc37ba7ae1ff1182cfce5858, whose CACHE is 1999-v35.
The current worker must be 1999-v36. Missing objects are fatal: do not invent an
old worker, silently skip migration, or fetch a worker from Production.

```sh
BASE=dedfeb5cd5cd1afcbc37ba7ae1ff1182cfce5858
git merge-base --is-ancestor "$BASE" HEAD
git cat-file -e "$BASE^{commit}"
git cat-file -e "$BASE:sw.js"
git show "$BASE:sw.js" | grep -F "const CACHE = '1999-v35';"
```

Use a full clone. In an authorized verification checkout only, a shallow clone
can be completed with `git fetch --unshallow origin`, followed by these checks.
The test itself never fetches history or changes Git references.

### Independent verification before any Push

After both commits exist locally, clone the dedicated repository into a fresh
directory. This copies committed history, not uncommitted working files, and
does not require a Push, GitHub mutation or deployment.

```sh
SOURCE=/absolute/path/to/.local/pr2-worktree
CHECKOUT="$(mktemp -d /tmp/pr2-clean-XXXXXX)"
git clone --no-hardlinks --single-branch --branch fix/production-audit-eight \
  "$SOURCE" "$CHECKOUT"
cd "$CHECKOUT"
git checkout --detach <commit-to-verify>
git status --porcelain
```

Verify commit 1 alone first, then commit 2 including its parent. Use a fresh
clone for each, or switch commits only inside this isolated checkout. Do not
reset or replace the original worktree. Status must remain empty after testing.

Set the paths to an externally provisioned Playwright 1.40 module and Chromium:

```sh
PW_MODULE=/absolute/path/to/playwright-module
CHROMIUM=/absolute/path/to/chromium
run() {
  env -i PATH="$PATH" HOME=/tmp GIT_OPTIONAL_LOCKS=0 \
    PLAYWRIGHT_MODULE="$PW_MODULE" CHROMIUM_PATH="$CHROMIUM" "$@"
}
run npm ci --ignore-scripts --no-audit --no-fund
run node --test scripts/test-cache-scheduling.mjs \
  scripts/test-auth-review-api.mjs scripts/test-session-revocation.mjs \
  scripts/test-public-surface.mjs
run node --test scripts/test-auth-review-browser.mjs
```

Expected Node suite totals are 12 at commit 1 (3 basic plus 9 existing tests)
and 18 at commit 2 (9 focused plus 9 existing tests). The auth browser suite
contains 12 internal tests; its runner can also report an outer file wrapper.

The management test uses the fixture on port 8099. Start it in a separate
isolated shell with the same environment function, wait for the listening
message, run the management test, and stop the fixture before the next test.
Do not run it concurrently with test-auth-review-browser.mjs, which starts its
own fixture on the same port.

```sh
# Fixture shell:
run node scripts/test-audit-browser.mjs --serve
# Test shell, after fixture startup:
run node scripts/test-auth-gate.mjs
# Stop the fixture, then:
run node scripts/test-audit-browser.mjs
git status --porcelain
git diff --check
```

Expected coverage also includes 70 management UI cases, public screens at nine
viewport widths, Music/Diary error recovery, playback/seeking, flyer controls,
and old-cache/internal-response removal. The verification runs used Chromium
with external Google font DNS blocked to keep synthetic tests independent of
font delivery. A test-shell-only launch wrapper can reproduce that option:

```sh
run_browser() {
  run node --input-type=module -e '
    import { createRequire } from "node:module";
    const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
    const launch = chromium.launch.bind(chromium);
    chromium.launch = options => launch({
      ...options, args: [...(options.args || []),
        "--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND"]
    });
    await import("./" + process.argv[1]);
  ' "$1"
}
run_browser scripts/test-auth-gate.mjs
run_browser scripts/test-audit-browser.mjs
```

Use these wrapper commands in place of the corresponding browser commands,
not as extra duplicate test runs. No stored browser or application settings are
changed. All application tokens and storage responses remain synthetic.

The same five tests in the earlier reproduction experiment failed against the
pre-fix handlers/worker and passed after the fix. This is historical evidence,
not the current nine-test suite count.
The pre-fix failures were one save where zero was expected, and cached 200
responses where anonymous 404 responses were expected.

Safari, Firefox, real CDN delivery and deployed environments are not verified.
