---
name: Vercel template bundle bump
description: Rule for ensuring Vercel re-bundles templates on deployment when template files change.
---

# Vercel template bundle — bump rule

**Rule:** Every time any file under `templates/` is changed, also update the bump comment in `api/afterhours-pages.js` in the same commit/push.

**Why:** `vercel.json` uses `"includeFiles": "templates/**"` to bundle templates into the `afterhours-pages.js` serverless function. Vercel may not detect that the function bundle needs rebuilding when only the included files (not the function JS itself) change. Updating the comment forces Vercel to treat the function file as changed and rebuild the bundle with the fresh templates.

**How to apply:** When editing any `templates/*.html` file, always update the line:
```
 * bump: <date> — <short description>
```
in `api/afterhours-pages.js` before pushing to GitHub. Use format `2026-07-08d`, `2026-07-08e`, etc. for multiple pushes on the same day.
