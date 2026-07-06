/**
 * Persistent storage for Vercel serverless functions.
 *
 * When UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set:
 *   → reads/writes use Upstash KV (persistent across cold-starts)
 *   → on first read (null from KV), the bundled data/*.json file seeds the KV store
 *
 * Otherwise (local dev / unconfigured):
 *   → falls back to filesystem (/tmp → process.cwd())
 *
 * All exports are async.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// ── Upstash REST helpers ──────────────────────────────────────────────────────

function upstashConfigured() {
    return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function upstashCmd(commands) {
    const url   = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    const res = await fetch(`${url}/pipeline`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(commands),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Upstash error ${res.status}: ${text}`);
    }
    return res.json();          // Array of { result, error } objects
}

// KV key from relative path: 'data/lives.json' → 'lives'
function kvKey(relPath) {
    return relPath.replace(/^data\//, '').replace(/\.json$/, '');
}

// ── Filesystem helpers (local dev fallback) ───────────────────────────────────

function readBundled(relPath) {
    try {
        const data = JSON.parse(readFileSync(join(process.cwd(), relPath), 'utf-8'));
        return Array.isArray(data) ? data : [];
    } catch { return []; }
}

function readFs(relPath) {
    // /tmp has recent writes; bundle is the cold-start baseline
    for (const base of ['/tmp', process.cwd()]) {
        try {
            const data = JSON.parse(readFileSync(join(base, relPath), 'utf-8'));
            if (Array.isArray(data)) return data;
        } catch { /* try next */ }
    }
    return [];
}

function writeFs(relPath, data) {
    const json = JSON.stringify(data, null, 2);
    for (const base of [process.cwd(), '/tmp']) {
        try {
            const p = join(base, relPath);
            mkdirSync(dirname(p), { recursive: true });
            writeFileSync(p, json, 'utf-8');
            return;
        } catch { /* try next */ }
    }
    throw new Error(`Failed to write ${relPath} to any writable path`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read a JSON array from persistent storage.
 * @param {string} relPath  e.g. 'data/lives.json'
 * @returns {Promise<Array>}
 */
export async function readJsonArray(relPath) {
    if (upstashConfigured()) {
        const key     = kvKey(relPath);
        const results = await upstashCmd([['GET', key]]);
        const raw     = results[0].result;

        if (raw !== null && raw !== undefined) {
            try {
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            } catch { return []; }
        }

        // First access: seed KV from bundled JSON file
        const seed = readBundled(relPath);
        await upstashCmd([['SET', key, JSON.stringify(seed)]]);
        console.log(`[storage] Seeded KV key "${key}" with ${seed.length} item(s) from bundle`);
        return seed;
    }

    // Local dev: use filesystem
    return readFs(relPath);
}

/**
 * Write a JSON array to persistent storage.
 * @param {string} relPath  e.g. 'data/lives.json'
 * @param {Array}  data
 * @returns {Promise<void>}
 */
export async function writeJsonArray(relPath, data) {
    if (upstashConfigured()) {
        const key = kvKey(relPath);
        await upstashCmd([['SET', key, JSON.stringify(data)]]);
        return;
    }

    // Local dev: use filesystem
    writeFs(relPath, data);
}
