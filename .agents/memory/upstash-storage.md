---
name: Upstash KV storage for Vercel
description: How Live and Diary data are persisted on Vercel using Upstash Redis REST API
---

## Setup
- Upstash DB URL: https://promoted-ferret-157579.upstash.io (env: UPSTASH_REDIS_REST_URL)
- Token stored in Replit secret UPSTASH_REDIS_REST_TOKEN
- Vercel also needs both vars set in project Settings → Environment Variables

## KV keys
- `lives` → JSON string of lives array (data/lives.json)
- `diary` → JSON string of diary posts array (data/diary.json)

## Architecture (api/_storage.js)
- readJsonArray(relPath): async, checks Upstash first; on null seeds from bundled file
- writeJsonArray(relPath, data): async, writes to Upstash; falls back to filesystem if unconfigured
- URL trailing slash stripped with .replace(/\/$/, '')
- Pipeline: POST /pipeline with body [["CMD","arg",...], ...]

## Why Upstash
Vercel Lambda /tmp is per-container and ephemeral on cold-starts.
Upstash provides persistent KV via HTTP — no TCP needed, works in serverless.

## Replit dev server
server.py uses filesystem directly (data/lives.json, data/diary.json).
Upstash is NOT used by server.py — only by Vercel API functions.
