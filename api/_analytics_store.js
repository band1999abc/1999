/**
 * Analytics storage for Vercel serverless functions.
 *
 * Upstash KV  — Redis Lists (atomic RPUSH / LRANGE)
 *   key format :  analytics:YYYY-MM-DD
 *   each value :  JSON-encoded event object
 *
 * Filesystem fallback (local dev, no Upstash env vars)
 *   path format :  data/analytics/YYYY-MM-DD.json  (JSON array)
 *
 * Date strings are always JST (UTC+9) so daily files align with Japan midnight.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ── Upstash helpers ───────────────────────────────────────────────────────────

function _upstashConfigured() {
    return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function _upstashCmd(commands) {
    const url   = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    const res = await fetch(`${url}/pipeline`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`Upstash HTTP error ${res.status}: ${await res.text()}`);
    const results = await res.json();   // Array of { result, error }
    // Surface per-command errors so callers aren't silently misled
    for (const r of results) {
        if (r.error) throw new Error(`Upstash command error: ${r.error}`);
    }
    return results;
}

function _kvKey(dateStr) { return `analytics:${dateStr}`; }

// ── Filesystem helpers ────────────────────────────────────────────────────────

function _fsPath(dateStr) {
    return join(process.cwd(), 'data', 'analytics', `${dateStr}.json`);
}

function _fsDir() {
    return join(process.cwd(), 'data', 'analytics');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Append a single analytics event for the given JST date.
 * Upstash: atomic RPUSH (no read-modify-write race).
 * Filesystem: read → push → write (single-threaded dev server).
 *
 * @param {string} dateStr  'YYYY-MM-DD' in JST
 * @param {object} event    Fully-formed event object
 */
export async function appendAnalyticsEvent(dateStr, event) {
    if (_upstashConfigured()) {
        await _upstashCmd([['RPUSH', _kvKey(dateStr), JSON.stringify(event)]]);
        return;
    }
    // Filesystem fallback
    try { mkdirSync(_fsDir(), { recursive: true }); } catch {}
    const p = _fsPath(dateStr);
    let events = [];
    try { events = JSON.parse(readFileSync(p, 'utf-8')); } catch {}
    if (!Array.isArray(events)) events = [];
    events.push(event);
    writeFileSync(p, JSON.stringify(events, null, 2), 'utf-8');
}

/**
 * Read all events for a single date.
 *
 * @param  {string}   dateStr  'YYYY-MM-DD'
 * @returns {Promise<object[]>}
 */
export async function readAnalyticsDay(dateStr) {
    if (_upstashConfigured()) {
        const results = await _upstashCmd([['LRANGE', _kvKey(dateStr), '0', '-1']]);
        const raw = results[0].result;
        if (!Array.isArray(raw)) return [];
        return raw
            .map(s => { try { return JSON.parse(s); } catch { return null; } })
            .filter(Boolean);
    }
    try {
        const data = JSON.parse(readFileSync(_fsPath(dateStr), 'utf-8'));
        return Array.isArray(data) ? data : [];
    } catch { return []; }
}

/**
 * Read events for multiple dates in a single Upstash pipeline call.
 * Returns all events sorted by timestamp ascending.
 *
 * @param  {string[]} dateStrs  Array of 'YYYY-MM-DD'
 * @returns {Promise<object[]>}
 */
export async function readAnalyticsDays(dateStrs) {
    if (!dateStrs.length) return [];

    if (_upstashConfigured()) {
        const cmds    = dateStrs.map(d => ['LRANGE', _kvKey(d), '0', '-1']);
        const results = await _upstashCmd(cmds);
        return results
            .flatMap(r =>
                Array.isArray(r.result)
                    ? r.result
                          .map(s => { try { return JSON.parse(s); } catch { return null; } })
                          .filter(Boolean)
                    : []
            )
            .sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
    }

    // Filesystem fallback
    const all = [];
    for (const d of dateStrs) {
        try {
            const data = JSON.parse(readFileSync(_fsPath(d), 'utf-8'));
            if (Array.isArray(data)) all.push(...data);
        } catch {}
    }
    return all.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
}
