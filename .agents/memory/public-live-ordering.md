---
name: Public Live ordering
description: Rationale for combining newest-first public pagination with the existing manual Live order.
---

On the public Live page, promote only the newest-created upcoming Live to the first position. Keep every other upcoming Live in the existing manual `sort_order`, and keep past Lives newest-event-date first.

**Why:** New Live additions must appear on page 1, but bulk-changing saved order or replacing the established manual sequence would violate the existing CMS behavior. Promoting one entry is the smallest display-only change that satisfies both constraints.

**How to apply:** Preserve this rule when changing public Live pagination or sorting. Do not rewrite stored `sort_order`; the After Hours admin list continues to use its existing manual order.