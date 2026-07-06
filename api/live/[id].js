/**
 * Vercel Serverless Function: /api/live/:id
 *
 * GET    — fetch single live
 * PUT    — update live (auth required)
 * DELETE — delete live (auth required)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { COOKIE_NAME, verifyToken, parseCookies } from '../_auth.js';

const DATA_PATH = join(process.cwd(), 'data', 'lives.json');
const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE   = /^\d{1,2}:\d{2}$/;

function loadLives() {
    try {
        const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
        return Array.isArray(data) ? data : [];
    } catch { return []; }
}

function saveLives(lives) {
    mkdirSync(join(process.cwd(), 'data'), { recursive: true });
    writeFileSync(DATA_PATH, JSON.stringify(lives, null, 2), 'utf-8');
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

export default function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    const { id } = req.query;
    const lives  = loadLives();
    const idx    = lives.findIndex(l => l.id === id);

    // ── GET /api/live/:id ─────────────────────────────────────────────────────
    if (req.method === 'GET') {
        if (idx < 0) return res.status(404).json({ error: 'Not found' });
        const live = lives[idx];
        if (live.status !== 'published' && !isAuthed(req)) {
            return res.status(404).json({ error: 'Not found' });
        }
        return res.status(200).json(live);
    }

    // ── PUT /api/live/:id ─────────────────────────────────────────────────────
    if (req.method === 'PUT') {
        if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
        if (idx < 0) return res.status(404).json({ error: 'Not found' });

        const prev = lives[idx];
        const { date, venue, open, start, ticket, status, sort_order } = req.body || {};

        if (date !== undefined && !DATE_RE.test(String(date))) {
            return res.status(400).json({ error: 'Invalid date format; expected YYYY-MM-DD' });
        }
        if (sort_order !== undefined && !Number.isFinite(Number(sort_order))) {
            return res.status(400).json({ error: 'sort_order must be an integer' });
        }

        const updated = {
            ...prev,
            date:       date       !== undefined ? String(date)                          : prev.date,
            venue:      venue      !== undefined ? String(venue).trim()                  : prev.venue,
            open:       open       !== undefined ? validTime(open)                       : prev.open,
            start:      start      !== undefined ? validTime(start)                      : prev.start,
            ticket:     ticket     !== undefined ? String(ticket).trim()                 : prev.ticket,
            status:     status && ['published', 'draft'].includes(status) ? status       : prev.status,
            sort_order: sort_order !== undefined ? Number(sort_order)                    : prev.sort_order,
            updatedAt:  new Date().toISOString(),
        };

        lives[idx] = updated;
        saveLives(lives);
        return res.status(200).json(updated);
    }

    // ── DELETE /api/live/:id ──────────────────────────────────────────────────
    if (req.method === 'DELETE') {
        if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
        if (idx < 0) return res.status(404).json({ error: 'Not found' });
        lives.splice(idx, 1);
        saveLives(lives);
        return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
