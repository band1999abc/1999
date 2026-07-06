/**
 * Vercel Serverless Function: /api/diary
 *
 * GET  — list posts (published only when not authed; all when authed)
 * POST — create post (auth required)
 *
 * NOTE: Vercel serverless functions are stateless. Writes made here do NOT
 * persist between deployments. For full admin functionality on Vercel,
 * replace the JSON file reads/writes with a database (e.g. Vercel KV, Supabase).
 * On the Replit dev server, persistent JSON file storage is used instead.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join }       from 'path';
import { randomUUID } from 'crypto';
import { COOKIE_NAME, verifyToken, parseCookies } from './_auth.js';

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
    const cookies = parseCookies(req.headers.cookie);
    return verifyToken(cookies[COOKIE_NAME] || '');
}

export default function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    // ── GET /api/diary ────────────────────────────────────────────────────────
    if (req.method === 'GET') {
        const authed = isAuthed(req);
        let posts = loadPosts();
        if (!authed) {
            posts = posts.filter(p => p.status === 'published');
        }
        // sort newest date first
        posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        return res.status(200).json(posts);
    }

    // ── POST /api/diary ───────────────────────────────────────────────────────
    if (req.method === 'POST') {
        if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

        const { title = '', body = '', date, status = 'draft' } = req.body || {};
        if (date && !DATE_RE.test(String(date))) {
            return res.status(400).json({ error: 'Invalid date format; expected YYYY-MM-DD' });
        }
        const now  = new Date().toISOString();
        const post = {
            id:        randomUUID(),
            title:     String(title).trim(),
            body:      String(body).trim(),
            date:      (date && DATE_RE.test(String(date))) ? String(date) : now.slice(0, 10),
            status:    ['published', 'draft'].includes(status) ? status : 'draft',
            createdAt: now,
            updatedAt: now
        };
        const posts = loadPosts();
        posts.unshift(post);
        savePosts(posts);
        return res.status(201).json(post);
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
