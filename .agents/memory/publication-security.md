---
name: Publication security
description: User requirements for publication changes, cached media and unavailable revocation checks.
---

Jackets and flyers can become non-public again. Their subsequent acquisition
must respect that change rather than reuse a previously published response.
Do not promise universal deletion of downloaded or already displayed images.

**Why:** The user requires immediate enforcement on re-acquisition while acknowledging browser/CDN cleanup limits.

**How to apply:** Distinguish HTTP response caching, Service Worker Cache Storage and supplementary logout cleanup when changing media delivery.

Requests with an unavailable session revocation check must not save scheduled
publication. Preserve existing published reads and normal scheduled publication.

**Why:** The user requires zero scheduled saves on failed revocation checks without unnecessarily breaking public GETs.

**How to apply:** Keep unknown verification separate from successful authentication, and check overdue list/detail cases when changing scheduling.
