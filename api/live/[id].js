/**
 * Vercel Serverless Function: /api/live/:id
 *
 * GET    — fetch single live
 * PUT    — update live (auth required)
 * DELETE — delete live (auth required)
 *
 * Body is read manually from the stream (same pattern as api/auth.js).
 */

import { COOKIE_NAME, verifyToken, parseCookies } from '../_auth.js';
import { readJsonArray, writeJsonArray } from '../_storage.js';

const FILE    = 'data/lives.json';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { return {}; }
}

function validTime(s) {
    const str = String(s || '').trim();
    return TIME_RE.test(str) ? str : '';
}

function isAuthed(req) {
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
        if (verifyToken(auth.slice(7)) !== null) return true;
    }
    const cookies = parseCookies(req.headers.cookie);
    return verifyToken(cookies[COOKIE_NAME] || '') !== null;
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    const { id } = req.query;
    const lives  = readJsonArray(FILE);
    const idx    = lives.findIndex(l => l.id === id);

    // ── GET /api/live/:id ─────────────────────────────────────────────────────
    if (req.method === 'GET') {
        if (idx < 0) return res.status(404).json({ error: 'Not found' });
        const live = lives[idx];
        if (live.status !== 'published' && !isAuthed(req))
            return res.status(404).json({ error: 'Not found' });
        return res.status(200).json(live);
    }

    // ── PUT /api/live/:id ─────────────────────────────────────────────────────
    if (req.method === 'PUT') {
        if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
        if (idx < 0)        return res.status(404).json({ error: 'Not found' });

        const body = await readBody(req);
        const { date, venue, open, start, ticket, status, sort_order } = body;
        const prev = lives[idx];

        if (date !== undefined && !DATE_RE.test(String(date)))
            return res.status(400).json({ error: 'Invalid date format; expected YYYY-MM-DD' });
        if (sort_order !== undefined && !Number.isFinite(Number(sort_order)))
            return res.status(400).json({ error: 'sort_order must be an integer' });

        const updated = {
            ...prev,
            date:       date       !== undefined ? String(date)              : prev.date,
            venue:      venue      !== undefined ? String(venue).trim()      : prev.venue,
            open:       open       !== undefined ? validTime(open)           : prev.open,
            start:      start      !== undefined ? validTime(start)          : prev.start,
            ticket:     ticket     !== undefined ? String(ticket).trim()     : prev.ticket,
            status:     status && ['published','draft'].includes(status) ? status : prev.status,
            sort_order: sort_order !== undefined ? Number(sort_order)        : prev.sort_order,
            updatedAt:  new Date().toISOString(),
        };

        try {
            lives[idx] = updated;
            writeJsonArray(FILE, lives);
        } catch (e) {
            console.error('[live] save error:', e);
            return res.status(500).json({ error: 'Failed to save' });
        }
        return res.status(200).json(updated);
    }

    // ── DELETE /api/live/:id ──────────────────────────────────────────────────
    if (req.method === 'DELETE') {
        if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
        if (idx < 0)        return res.status(404).json({ error: 'Not found' });

        try {
            lives.splice(idx, 1);
            writeJsonArray(FILE, lives);
        } catch (e) {
            console.error('[live] delete error:', e);
            return res.status(500).json({ error: 'Failed to delete' });
        }
        return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
