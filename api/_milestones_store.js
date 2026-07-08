/**
 * api/_milestones_store.js
 * Achievement-date storage for the Milestones feature.
 *
 * Upstash KV  — milestones:achieved:<id>  →  ISO datetime string
 *               Written write-once via NX flag.
 *
 * Filesystem fallback (local dev, no Upstash)
 *               data/milestones.json  →  { "<id>": "<ISO>" }
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

function _configured() {
    return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function _cmd(commands) {
    const url   = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    const res = await fetch(`${url}/pipeline`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`Upstash HTTP ${res.status}: ${await res.text()}`);
    const results = await res.json();
    for (const r of results) {
        if (r.error) throw new Error(`Upstash cmd error: ${r.error}`);
    }
    return results;
}

function _kvKey(id)  { return `milestones:achieved:${id}`; }
function _fsPath()   { return join(process.cwd(), 'data', 'milestones.json'); }
function _fsRead()   { try { return JSON.parse(readFileSync(_fsPath(), 'utf-8')); } catch { return {}; } }
function _fsWrite(o) { try { writeFileSync(_fsPath(), JSON.stringify(o, null, 2), 'utf-8'); } catch {} }

/**
 * Read achievement dates for a list of milestone IDs.
 * @param   {string[]} ids
 * @returns {Promise<Record<string, string|null>>}  id → ISO string or null
 */
export async function getAchievementDates(ids) {
    if (!ids.length) return {};

    if (_configured()) {
        const results = await _cmd(ids.map(id => ['GET', _kvKey(id)]));
        const out = {};
        ids.forEach((id, i) => { out[id] = results[i].result || null; });
        return out;
    }

    const store = _fsRead();
    const out   = {};
    ids.forEach(id => { out[id] = store[id] || null; });
    return out;
}

/**
 * Store an achievement date write-once (NX — only if the key is absent).
 * @param   {string}  id       Milestone ID
 * @param   {string}  isoDate  ISO datetime string
 * @returns {Promise<boolean>} true if newly stored, false if already existed
 */
export async function setAchievementDateIfNew(id, isoDate) {
    if (_configured()) {
        const results = await _cmd([['SET', _kvKey(id), isoDate, 'NX']]);
        return results[0].result === 'OK';
    }

    const store = _fsRead();
    if (store[id]) return false;
    store[id] = isoDate;
    _fsWrite(store);
    return true;
}
