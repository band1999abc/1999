/**
 * Vercel Serverless Function: /api/diary/:id
 *
 * GET    — fetch single post
 * PUT    — update post (auth required)
 * DELETE — delete post (auth required)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { COOKIE_NAME, verifyToken, parseCookies } from '../_auth.js';

const DATA_PATH = join(process.cwd(), 'data', 'diary.json');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function loadPosts() {
    try {
        const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
        return Array.isArray(data) ? data : [];
    } catch { return []; }
}

function savePosts(posts) {
    mkdirSync(join(process.cwd(), 'data'), { recursive: true });
    writeFileSync(DATA_PATH, JSON.stringify(posts, null, 2), 'utf-8');
}

function isAuthed(req) {
    // Bearer header (sessionStorage path)
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
        if (verifyToken(auth.slice(7)) !== null) return true;
    }
    // Cookie fallback
    const cookies = parseCookies(req.headers.cookie);
    return verifyToken(cookies[COOKIE_NAME] || '') !== null;
}

export default function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    const { id } = req.query;
    const posts  = loadPosts();
    const idx    = posts.findIndex(p => p.id === id);

    // ── GET /api/diary/:id ────────────────────────────────────────────────────
    if (req.method === 'GET') {
        if (idx < 0) return res.status(404).json({ error: 'Not found' });
        const post = posts[idx];
        if (post.status !== 'published' && !isAuthed(req)) {
            return res.status(404).json({ error: 'Not found' });
        }
        return res.status(200).json(post);
    }

    // ── PUT /api/diary/:id ────────────────────────────────────────────────────
    if (req.method === 'PUT') {
        if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
        if (idx < 0) return res.status(404).json({ error: 'Not found' });

        const prev = posts[idx];
        const { title, body, date, status } = req.body || {};
        if (date !== undefined && !DATE_RE.test(String(date))) {
            return res.status(400).json({ error: 'Invalid date format; expected YYYY-MM-DD' });
        }
        const updated = {
            ...prev,
            title:     title     !== undefined ? String(title).trim()  : prev.title,
            body:      body      !== undefined ? String(body).trim()   : prev.body,
            date:      date      !== undefined ? date                  : prev.date,
            status:    status && ['published','draft'].includes(status) ? status : prev.status,
            updatedAt: new Date().toISOString()
        };
        posts[idx] = updated;
        savePosts(posts);
        return res.status(200).json(updated);
    }

    // ── DELETE /api/diary/:id ─────────────────────────────────────────────────
    if (req.method === 'DELETE') {
        if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
        if (idx < 0) return res.status(404).json({ error: 'Not found' });
        posts.splice(idx, 1);
        savePosts(posts);
        return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
