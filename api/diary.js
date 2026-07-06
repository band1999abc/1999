/**
 * Vercel Serverless Function: /api/diary
 *
 * GET  — list posts (published only when not authed; all when authed)
 * POST — create post (auth required)
 */

import { randomUUID } from 'crypto';
import { COOKIE_NAME, verifyToken, parseCookies } from './_auth.js';
import { readJsonArray, writeJsonArray } from './_storage.js';

const FILE    = 'data/diary.json';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isAuthed(req) {
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
        if (verifyToken(auth.slice(7)) !== null) return true;
    }
    const cookies = parseCookies(req.headers.cookie);
    return verifyToken(cookies[COOKIE_NAME] || '') !== null;
}

export default function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    // ── GET /api/diary ────────────────────────────────────────────────────────
    if (req.method === 'GET') {
        let posts = readJsonArray(FILE);
        if (!isAuthed(req)) posts = posts.filter(p => p.status === 'published');
        posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        return res.status(200).json(posts);
    }

    // ── POST /api/diary ───────────────────────────────────────────────────────
    if (req.method === 'POST') {
        if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

        const { title = '', body = '', date, status = 'draft' } = req.body || {};
        if (date && !DATE_RE.test(String(date)))
            return res.status(400).json({ error: 'Invalid date format; expected YYYY-MM-DD' });

        const now  = new Date().toISOString();
        const post = {
            id:        randomUUID(),
            title:     String(title).trim(),
            body:      String(body).trim(),
            date:      (date && DATE_RE.test(String(date))) ? String(date) : now.slice(0, 10),
            status:    ['published', 'draft'].includes(status) ? status : 'draft',
            createdAt: now,
            updatedAt: now,
        };

        try {
            const posts = readJsonArray(FILE);
            posts.unshift(post);
            writeJsonArray(FILE, posts);
        } catch (e) {
            console.error('[diary] save error:', e);
            return res.status(500).json({ error: 'Failed to save' });
        }
        return res.status(201).json(post);
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
