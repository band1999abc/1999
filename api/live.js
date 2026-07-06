/**
 * Vercel Serverless Function: /api/live
 *
 * GET  — list lives (published only when not authed; all when authed)
 * POST — create live (auth required)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join }       from 'path';
import { randomUUID } from 'crypto';
import { COOKIE_NAME, verifyToken, parseCookies } from './_auth.js';

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

    // ── GET /api/live ─────────────────────────────────────────────────────────
    if (req.method === 'GET') {
        let lives = loadLives();
        if (!isAuthed(req)) {
            lives = lives.filter(l => l.status === 'published');
        }
        return res.status(200).json(lives);
    }

    // ── POST /api/live ────────────────────────────────────────────────────────
    if (req.method === 'POST') {
        if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

        const { date, venue = '', open = '', start = '', ticket = '', status = 'draft', sort_order } = req.body || {};

        if (date && !DATE_RE.test(String(date))) {
            return res.status(400).json({ error: 'Invalid date format; expected YYYY-MM-DD' });
        }
        if (sort_order !== undefined && !Number.isFinite(Number(sort_order))) {
            return res.status(400).json({ error: 'sort_order must be an integer' });
        }

        const lives    = loadLives();
        const maxOrder = lives.reduce((m, l) => Math.max(m, l.sort_order ?? 0), -1);
        const now      = new Date().toISOString();

        const live = {
            id:         randomUUID(),
            date:       (date && DATE_RE.test(String(date))) ? String(date) : now.slice(0, 10),
            venue:      String(venue).trim(),
            open:       validTime(open),
            start:      validTime(start),
            ticket:     String(ticket).trim(),
            status:     ['published', 'draft'].includes(status) ? status : 'draft',
            sort_order: sort_order !== undefined ? Number(sort_order) : maxOrder + 1,
            createdAt:  now,
            updatedAt:  now,
        };

        lives.push(live);
        saveLives(lives);
        return res.status(201).json(live);
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
