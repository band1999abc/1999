/**
 * Vercel Serverless Function: /api/diary/:id
 *
 * GET    — fetch single post
 * PUT    — update post (auth required)
 * DELETE — delete post (auth required)
 */

import { COOKIE_NAME, verifyToken, parseCookies } from '../_auth.js';
import { readJsonArray, writeJsonArray } from '../_storage.js';

const FILE     = 'data/diary.json';
const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/;
const SCHED_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

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
    return d.toISOString().slice(0, 16);
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
            p.status    = 'published';
            p.updatedAt = new Date().toISOString();
            changed     = true;
        }
    }
    return changed;
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    const { id } = req.query;
    const posts  = await readJsonArray(FILE);
    const idx    = posts.findIndex(p => p.id === id);

    // ── GET /api/diary/:id ────────────────────────────────────────────────────
    if (req.method === 'GET') {
        // Auto-promote scheduled posts whose time has passed (JST)
        if (autoPromote(posts)) {
            await writeJsonArray(FILE, posts).catch(e =>
                console.error('[diary/id] auto-promote save error:', e)
            );
        }
        const updatedIdx = posts.findIndex(p => p.id === id);
        if (updatedIdx < 0) return res.status(404).json({ error: 'Not found' });
        const post = posts[updatedIdx];
        if (post.status !== 'published' && !isAuthed(req))
            return res.status(404).json({ error: 'Not found' });
        return res.status(200).json(post);
    }

    // ── PUT /api/diary/:id ────────────────────────────────────────────────────
    if (req.method === 'PUT') {
        if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
        if (idx < 0)        return res.status(404).json({ error: 'Not found' });

        const body = await readBody(req);
        const { title, body: text, date, status, scheduledAt } = body;
        const prev = posts[idx];

        if (date !== undefined && !DATE_RE.test(String(date)))
            return res.status(400).json({ error: 'Invalid date format; expected YYYY-MM-DD' });

        const validStatuses = ['published', 'draft', 'scheduled'];
        const safeStatus = status && validStatuses.includes(status) ? status : prev.status;

        // scheduledAt validation
        const rawSched = scheduledAt !== undefined
            ? String(scheduledAt).trim()
            : (prev.scheduledAt || '');
        if (safeStatus === 'scheduled') {
            if (!rawSched || !SCHED_RE.test(rawSched))
                return res.status(400).json({ error: 'scheduledAt required (YYYY-MM-DDTHH:MM)' });
        }

        const updated = {
            ...prev,
            title:       title       !== undefined ? String(title).trim()  : prev.title,
            body:        text        !== undefined ? String(text).trim()   : prev.body,
            date:        date        !== undefined ? String(date)          : prev.date,
            status:      safeStatus,
            scheduledAt: safeStatus === 'scheduled' ? rawSched : '',
            updatedAt:   new Date().toISOString(),
        };

        try {
            posts[idx] = updated;
            await writeJsonArray(FILE, posts);
        } catch (e) {
            console.error('[diary] update error:', e);
            return res.status(500).json({ error: 'Failed to save' });
        }
        return res.status(200).json(updated);
    }

    // ── DELETE /api/diary/:id ─────────────────────────────────────────────────
    if (req.method === 'DELETE') {
        if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
        if (idx < 0)        return res.status(404).json({ error: 'Not found' });

        try {
            posts.splice(idx, 1);
            await writeJsonArray(FILE, posts);
        } catch (e) {
            console.error('[diary] delete error:', e);
            return res.status(500).json({ error: 'Failed to delete' });
        }
        return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
