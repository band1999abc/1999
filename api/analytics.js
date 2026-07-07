/**
 * Vercel Serverless Function: /api/analytics
 *
 * POST — collect an analytics event (public, no auth required)
 *        Body: { visitor_id, session_id, page, event, is_new_visitor, props }
 *        Response: 204 No Content
 *
 * GET  — query stored events (admin only)
 *        Query params: ?start=YYYY-MM-DD&end=YYYY-MM-DD  (default: today JST)
 *        Response: { start, end, count, events[] }
 *
 * Event dispatch: each event type has its own handler function.
 * To add a new event type, register a handler in EVENT_HANDLERS below —
 * no new Vercel function required.
 */

import { randomUUID }    from 'crypto';
import { COOKIE_NAME, verifyToken, parseCookies } from './_auth.js';
import { appendAnalyticsEvent, readAnalyticsDays, getFirstDate } from './_analytics_store.js';

// ── Validation constants ──────────────────────────────────────────────────────

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_MAX = 300;

// ── Event handlers ────────────────────────────────────────────────────────────
//
// Each function receives (props) and returns an error string or null.
// Return null  → event is accepted and stored.
// Return string → event is rejected with HTTP 400 and that message.
//
// To add a new event type:
//   1. Write a handler function (or use `() => null` for no extra validation)
//   2. Add one entry to EVENT_HANDLERS below
//   3. Also add the key to analytics.js (client-side VALID_EVENTS)
//
// No new Vercel functions needed. Function count stays fixed.

function onVisit(props)       { return null; }  // session-start beacon, any props OK
function onPageView(props)    { return null; }  // any props OK
function onMusicPlay(props) {
    if (props.track !== undefined && typeof props.track !== 'string')
        return 'props.track must be a string';
    return null;
}
function onDiaryView(props)   { return null; }
function onLiveView(props)    { return null; }
function onContactView(props) { return null; }

/** Registry of valid event types → validator functions. */
const EVENT_HANDLERS = {
    visit:        onVisit,
    page_view:    onPageView,
    music_play:   onMusicPlay,
    diary_view:   onDiaryView,
    live_view:    onLiveView,
    contact_view: onContactView,
};

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
 * @param {number} [max=90]  Hard cap on number of dates (prevents abuse on public endpoint).
 *                            Pass Infinity for authenticated admin requests.
 */
function dateRange(start, end, max = 90) {
    const dates = [];
    let cur = new Date(start + 'T00:00:00Z');
    const last = new Date(end + 'T00:00:00Z');
    while (cur <= last && dates.length < max) {
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

        // Validate base required fields
        if (!UUID_RE.test(String(visitor_id || '')))
            return res.status(400).json({ error: 'Invalid visitor_id' });
        if (!UUID_RE.test(String(session_id || '')))
            return res.status(400).json({ error: 'Invalid session_id' });

        // Dispatch to event-specific handler
        const eventKey     = String(event || '');
        const eventHandler = EVENT_HANDLERS[eventKey];
        if (!eventHandler)
            return res.status(400).json({ error: 'Invalid event' });

        const safePage  = String(page || '/').slice(0, PAGE_MAX);
        const safeProps = (props && typeof props === 'object' && !Array.isArray(props)) ? props : {};

        // Per-event props validation
        const eventErr = eventHandler(safeProps);
        if (eventErr) return res.status(400).json({ error: eventErr });

        const now     = new Date();
        const dateStr = todayJST();   // JST date for daily bucketing

        const entry = {
            id:             randomUUID(),
            ts:             now.toISOString(),          // UTC timestamp
            visitor_id:     String(visitor_id),
            session_id:     String(session_id),
            page:           safePage,
            event:          eventKey,
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

        const today     = todayJST();
        const firstDate = await getFirstDate().catch(() => null);

        const qs       = new URL(req.url, 'http://localhost').searchParams;
        const rawStart = qs.get('start') || firstDate || today;
        const rawEnd   = qs.get('end')   || today;
        const start    = DATE_RE.test(rawStart) ? rawStart : (firstDate || today);
        const end      = DATE_RE.test(rawEnd)   ? rawEnd   : today;

        try {
            // No day cap for authenticated admin requests — full history is allowed
            const events = await readAnalyticsDays(dateRange(start, end, Infinity));
            return res.status(200).json({ firstDate, start, end, count: events.length, events });
        } catch (e) {
            console.error('[analytics] read error:', e.message);
            return res.status(500).json({ error: 'Storage error' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
