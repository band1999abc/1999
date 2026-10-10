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
This first commit contains the F1 scenario and two no-worker media tests (three
tests total). Running-worker migration and bounded failure detection are added
in the dependent second commit; they are not claimed as coverage in this tree.

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
- Run from the checkout root. This three-test version does not read an old
  commit object or need access to GitHub.

The same five tests in the earlier reproduction experiment failed against the
pre-fix handlers/worker and passed after the fix. This is historical evidence,
not the current three-test suite count.
The pre-fix failures were one save where zero was expected, and cached 200
responses where anonymous 404 responses were expected.

Safari, Firefox, real CDN delivery and deployed environments are not verified.
