/**
 * Shared filesystem storage helpers for Vercel serverless functions.
 *
 * Vercel's Lambda environment has a read-only /var/task (process.cwd()).
 * We try writing there first (works on Replit / local dev), then fall back
 * to /tmp (always writable on Lambda, but ephemeral per cold-start).
 *
 * Read order: /tmp/<file>  →  process.cwd()/<file>
 * Write order: process.cwd()/<file>  →  /tmp/<file>  (first success wins)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Read JSON array from a project-relative path.
 * Falls back to [] on any error.
 * @param {string} relPath  e.g. 'data/lives.json'
 * @returns {Array}
 */
export function readJsonArray(relPath) {
    const tmpPath    = join('/tmp', relPath);
    const bundlePath = join(process.cwd(), relPath);

    for (const path of [tmpPath, bundlePath]) {
        try {
            const data = JSON.parse(readFileSync(path, 'utf-8'));
            if (Array.isArray(data)) return data;
        } catch { /* try next */ }
    }
    return [];
}

/**
 * Write JSON array to a project-relative path.
 * Tries process.cwd() first (Replit / local), then /tmp (Vercel Lambda).
 * Throws only if both fail.
 * @param {string} relPath  e.g. 'data/lives.json'
 * @param {Array}  data
 */
export function writeJsonArray(relPath, data) {
    const json = JSON.stringify(data, null, 2);

    // 1. Try the bundle/project path (persists on Replit, read-only on Vercel)
    try {
        const bundlePath = join(process.cwd(), relPath);
        mkdirSync(dirname(bundlePath), { recursive: true });
        writeFileSync(bundlePath, json, 'utf-8');
        return;
    } catch { /* fall through to /tmp */ }

    // 2. Fall back to /tmp (writable on Vercel Lambda, ephemeral on cold-start)
    const tmpPath = join('/tmp', relPath);
    mkdirSync(dirname(tmpPath), { recursive: true });
    writeFileSync(tmpPath, json, 'utf-8');
}
