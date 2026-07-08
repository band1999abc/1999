---
name: Music CMS architecture
description: How the Music admin page is built, its schema, API endpoints, storage, and key gotchas
---

## Data schema (data/music.json)
```json
{ "id": "uuid", "title": "曲名", "titleEn": "", "releaseDate": "YYYY-MM-DD",
  "type": "single|ep|album", "status": "published|scheduled|draft",
  "scheduledAt": "YYYY-MM-DDTHH:MM", "jacket": false,
  "audioUrl": "", "lyrics": "", "productionNote": "",
  "createdAt": "ISO", "updatedAt": "ISO" }
```

## Storage
- Music records: `data/music.json` (KV key `music`)
- Jacket image: single image per track, FS at `data/music_jackets/{id}.b64`, KV key `music_jacket:{id}`
- Audio: external URL only (text field) — no binary audio upload

## API endpoints
| Method | Path | Notes |
|--------|------|-------|
| GET/POST | `/api/music` | list (public: published only) / create |
| GET/PUT/DELETE | `/api/music/:id` | CRUD |
| GET/POST/DELETE | `/api/music-jacket/:id` | jacket image binary |

## Files involved
- `templates/afterhours-music.html` — admin page (data-page="afterhours-music")
- `music-admin.js` — client JS (list/editor/preview/confirm views, `.mc-*` classes)
- `api/_storage.js` — added readMusicJacket/writeMusicJacket/deleteMusicJacket
- `api/[resource].js` — added musicList/musicCreate; registered `music` in HANDLERS
- `api/[resource]/[id].js` — added musicGet/Put/Delete + musicJacketGet/Post/Delete; registered `music` and `music-jacket` in HANDLERS
- `server.py` — added music data helpers, handler methods, routes in do_GET/POST/PUT/DELETE
- `admin.css` — appended `.mc-*` styles (music CMS UI classes)
- `vercel.json` — added `/afterhours/music` rewrite
- `api/afterhours-pages.js` — added `music: 'afterhours-music.html'`
- `templates/afterhours.html` — Music module changed from "Coming soon" div to link

## Key rules
**Why:** admin.js auth gate uses a hardcoded `if (page === '...' || ...)` — every new admin page must be added to this list or `auth-hidden` is never removed and the page stays blank.

**How to apply:** When adding any new `data-page="afterhours-*"` page, always add the page name to the condition in `admin.js` (search for `afterhours-analytics` to find the right line).

**Auto-promote timing:** `_auto_promote_music` in server.py uses JST (UTC+9) via `datetime.timezone.utc + timedelta(hours=9)`, matching the JS handlers' `nowJSTMusic()`. Both must use JST for consistency.

**CSS prefix:** `.mc-*` for music admin (music CMS), `.am-*` for analytics music panel — do not mix.
