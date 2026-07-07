/**
 * Vercel Serverless Function: /api/diary
 *
 * GET  — list posts (published only when not authed; all when authed)
 * POST — create post (auth required)
 */

import { randomUUID } from 'crypto';
import { COOKIE_NAME, verifyToken, parseCookies } from './_auth.js';
import { readJsonArray, writeJsonArray } from './_storage.js';

const FILE       = 'data/diary.json';
const DATE_RE    = /^\d{4}-\d{2}-\d{2}$/;
const SCHED_RE   = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { return {}; }
}

function isAuthed(req) {
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
        if (verifyToken(auth.slice(7)) !== null) return true;
    }
    const cookies = parseCookies(req.headers.cookie);
    return verifyToken(cookies[COOKIE_NAME] || '') !== null;
}

/** Current Japan time as 'YYYY-MM-DDTHH:MM' (JST = UTC+9). */
function nowJST() {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
}

/**
 * Promote 'scheduled' posts whose scheduledAt has passed.
 * Returns true if any post was changed.
 */
function autoPromote(posts) {
    const now = nowJST();
    let changed = false;
    for (const p of posts) {
        if (p.status === 'scheduled' && p.scheduledAt && p.scheduledAt <= now) {
            p.status      = 'published';
            p.updatedAt   = new Date().toISOString();
            changed       = true;
        }
    }
    return changed;
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    // ── GET /api/diary ────────────────────────────────────────────────────────
    if (req.method === 'GET') {
        let posts = await readJsonArray(FILE);
        // Auto-promote scheduled posts whose time has passed (JST)
        if (autoPromote(posts)) {
            await writeJsonArray(FILE, posts).catch(e =>
                console.error('[diary] auto-promote save error:', e)
            );
        }
        if (!isAuthed(req)) posts = posts.filter(p => p.status === 'published');
        posts.sort((a, b) => {
            const da = (b.date || '') + (b.scheduledAt || '');
            const db = (a.date || '') + (a.scheduledAt || '');
            return da.localeCompare(db);
        });
        return res.status(200).json(posts);
    }

    // ── POST /api/diary ───────────────────────────────────────────────────────
    if (req.method === 'POST') {
        if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

        const body = await readBody(req);
        const { title = '', body: text = '', date, status = 'draft', scheduledAt = '' } = body;

        if (date && !DATE_RE.test(String(date)))
            return res.status(400).json({ error: 'Invalid date format; expected YYYY-MM-DD' });

        const validStatuses = ['published', 'draft', 'scheduled'];
        const safeStatus = validStatuses.includes(status) ? status : 'draft';

        // scheduledAt validation
        const safeScheduledAt = String(scheduledAt || '').trim();
        if (safeStatus === 'scheduled') {
            if (!safeScheduledAt || !SCHED_RE.test(safeScheduledAt))
                return res.status(400).json({ error: 'scheduledAt required (YYYY-MM-DDTHH:MM)' });
        }

        const now  = new Date().toISOString();
        const post = {
            id:          randomUUID(),
            title:       String(title).trim(),
            body:        String(text).trim(),
            date:        (date && DATE_RE.test(String(date))) ? String(date) : now.slice(0, 10),
            status:      safeStatus,
            scheduledAt: safeStatus === 'scheduled' ? safeScheduledAt : '',
            createdAt:   now,
            updatedAt:   now,
        };

        try {
            const posts = await readJsonArray(FILE);
            posts.unshift(post);
            await writeJsonArray(FILE, posts);
        } catch (e) {
            console.error('[diary] save error:', e);
            return res.status(500).json({ error: 'Failed to save' });
        }
        return res.status(201).json(post);
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
