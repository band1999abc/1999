/**
 * Vercel Serverless Function: /api/analytics
 *
 * POST — collect an analytics event (public, no auth required)
 *        Body: { visitor_id, session_id, page, event, is_new_visitor, props }
 *        Response: 204 No Content
 *
 * GET  — query stored events (admin only, for future analytics screen)
 *        Query params: ?start=YYYY-MM-DD&end=YYYY-MM-DD  (default: today JST)
 *        Response: { start, end, count, events[] }
 */

import { randomUUID }    from 'crypto';
import { COOKIE_NAME, verifyToken, parseCookies } from './_auth.js';
import { appendAnalyticsEvent, readAnalyticsDays } from './_analytics_store.js';

// ── Validation constants ──────────────────────────────────────────────────────

const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE   = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_MAX  = 300;

const VALID_EVENTS = new Set([
    'page_view',
    'music_play',
    'diary_view',
    'live_view',
    'contact_view',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { return null; }
}

function isAuthed(req) {
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ') && verifyToken(auth.slice(7)) !== null) return true;
    const cookies = parseCookies(req.headers.cookie);
    return verifyToken(cookies[COOKIE_NAME] || '') !== null;
}

/** Current date string in JST (UTC+9), e.g. '2026-07-08' */
function todayJST() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Generate an array of 'YYYY-MM-DD' strings from start to end (inclusive).
 * Capped at 90 days to prevent abuse.
 */
function dateRange(start, end) {
    const dates = [];
    let cur = new Date(start + 'T00:00:00Z');
    const last = new Date(end + 'T00:00:00Z');
    while (cur <= last && dates.length < 90) {
        dates.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    // ── POST /api/analytics — collect event ────────────────────────────────────
    if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body || typeof body !== 'object')
            return res.status(400).json({ error: 'Invalid JSON' });

        const { visitor_id, session_id, page, event, is_new_visitor, props } = body;

        // Validate required fields
        if (!UUID_RE.test(String(visitor_id || '')))
            return res.status(400).json({ error: 'Invalid visitor_id' });
        if (!UUID_RE.test(String(session_id || '')))
            return res.status(400).json({ error: 'Invalid session_id' });
        if (!VALID_EVENTS.has(String(event || '')))
            return res.status(400).json({ error: 'Invalid event' });

        const safePage  = String(page || '/').slice(0, PAGE_MAX);
        const safeProps = (props && typeof props === 'object' && !Array.isArray(props)) ? props : {};

        const now     = new Date();
        const dateStr = todayJST();   // JST date for daily bucketing

        const entry = {
            id:             randomUUID(),
            ts:             now.toISOString(),          // UTC timestamp
            visitor_id:     String(visitor_id),
            session_id:     String(session_id),
            page:           safePage,
            event:          String(event),
            is_new_visitor: Boolean(is_new_visitor),
            props:          safeProps,
        };

        try {
            await appendAnalyticsEvent(dateStr, entry);
        } catch (e) {
            console.error('[analytics] append error:', e.message);
            return res.status(500).json({ error: 'Storage error' });
        }

        return res.status(204).end();
    }

    // ── GET /api/analytics — query events (admin only) ─────────────────────────
    if (req.method === 'GET') {
        if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

        const today    = todayJST();
        const qs       = new URL(req.url, 'http://localhost').searchParams;
        const rawStart = qs.get('start') || today;
        const rawEnd   = qs.get('end')   || today;
        const start    = DATE_RE.test(rawStart) ? rawStart : today;
        const end      = DATE_RE.test(rawEnd)   ? rawEnd   : today;

        try {
            const events = await readAnalyticsDays(dateRange(start, end));
            return res.status(200).json({ start, end, count: events.length, events });
        } catch (e) {
            console.error('[analytics] read error:', e.message);
            return res.status(500).json({ error: 'Storage error' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
