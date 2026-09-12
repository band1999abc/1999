---
name: Service Worker asset versions
description: Cache invalidation rule for static assets served through the project's cache-first Service Worker.
---

When changing a static asset used by a page, give its page reference a new query-string version unless the Service Worker caching strategy is also intentionally changed.

**Why:** Static assets are served cache-first, and Cache Storage keys include the full URL. Redeploying different content under the same versioned URL leaves existing clients on the previously cached body.

**How to apply:** Before releasing a changed CSS or JavaScript file, check its current page reference and increment that asset's query version as part of the same focused release.