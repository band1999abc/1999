---
name: Viewport layout behavior
description: Why hibiware uses a distinct scroll origin and when page outer spacing may contract.
---

The hibiware lyric page must derive its parallax target directly from document scroll, rather than subtracting the card's document-top offset.

**Why:** On Android, subtracting the mobile card's top spacing created an initial scroll dead zone. Inertial state left from returning to the top then made the second scroll look different from the first.

**How to apply:** Preserve the existing interpolation and visual treatment, but keep hibiware's scroll origin distinct from other pages and resynchronize restored scroll state after page and font loading.

Outer page spacing may contract only when the complete card fits in the current visual viewport. If the card is taller, normal flow and the preferred spacing must remain so content scrolls naturally.

**Why:** Fixed outer spacing alone caused small document scroll ranges on short viewports even when the card itself fit. Globally suppressing overflow would break lyrics and future list growth.

**How to apply:** Recalculate against visual viewport and card size changes. Never solve this with document-level overflow clipping or a fixed card height.