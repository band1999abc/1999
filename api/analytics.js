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
import { COOKIE_NAME, verifyToken, parseCookies, extractToken, isRevoked } from './_auth.js';
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
function onTrackView(props) {
    // Fired when a visitor navigates to a track detail page (song-link click).
    if (props.track !== undefined && typeof props.track !== 'string')
        return 'props.track must be a string';
    return null;
}
function onDiaryView(props)   { return null; }
function onLiveView(props)    { return null; }
function onContactView(props) { return null; }
function onQrScan(props) {
    // props.edition — optional QR card edition identifier (for future per-edition analysis)
    if (props.edition !== undefined) {
        if (typeof props.edition !== 'string') return 'props.edition must be a string';
        if (props.edition.length > 50)         return 'props.edition too long (max 50)';
    }
    return null;
}

/** Registry of valid event types → validator functions. */
const EVENT_HANDLERS = {
    visit:        onVisit,
    page_view:    onPageView,
    music_play:   onMusicPlay,
    track_view:   onTrackView,   // 楽曲詳細ページへの遷移（music_play とは別）
    diary_view:   onDiaryView,
    live_view:    onLiveView,
    contact_view: onContactView,
    qr_scan:      onQrScan,    // QR card landing — fired client-side on ?ref=qr
};

// ── UA / geo parsing (server-side, no external deps) ─────────────────────────

/**
 * Parse User-Agent into device and browser category strings.
 * Returns lowercase keys that the client JS maps to display labels.
 */
/**
 * Parse User-Agent (+ optional Client Hint headers) into device and browser.
 *
 * iPadOS 13+ quirk: Safari on iPad reports "Macintosh" in the UA string, not
 * "iPad". We resolve this with two signals in priority order:
 *   1. Sec-CH-UA-Platform = '"iOS"' + Sec-CH-UA-Mobile = '?0'  → tablet
 *   2. Legacy UA heuristics (iPhone / iPad / Android / etc.)
 *
 * @param {string} ua        User-Agent header value
 * @param {object} hints     Partial request headers for client-hint fallback
 */
function parseUA(ua, hints = {}) {
    const s = String(ua || '');

    // --- Device ---
    // Client hints (sent automatically by Chromium-family; Safari 15.4+ with permissions)
    const platform = String(hints['sec-ch-ua-platform'] || '');
    const mobile   = String(hints['sec-ch-ua-mobile']   || '');

    let device;
    if      (/iPhone/i.test(s))                                device = 'iphone';
    else if (/iPad/i.test(s))                                  device = 'tablet';
    // iPadOS 13+: UA says "Macintosh" — detect via client hints if available
    else if (platform === '"iOS"' && mobile === '?0')           device = 'tablet';
    // Android tablet: no "Mobile" token in UA
    else if (/Android/i.test(s) && !/Mobile/i.test(s))        device = 'tablet';
    else if (/Android/i.test(s))                               device = 'android';
    else if (/Tablet|PlayBook|Kindle|Silk/i.test(s))           device = 'tablet';
    else                                                       device = 'pc';

    // --- Browser ---
    // Edge must precede Chrome: Chromium-based Edge includes "Chrome/" in its UA.
    let browser;
    if      (/Edg\//i.test(s) || /Edge\//i.test(s))            browser = 'edge';
    else if (/Firefox\//i.test(s))                             browser = 'firefox';
    else if (/Chrome\//i.test(s))                              browser = 'chrome';
    else if (/Safari\//i.test(s))                              browser = 'safari';
    else                                                       browser = 'other';

    return { device, browser };
}

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

        // Server-side device / browser / country enrichment
        const { device, browser } = parseUA(req.headers['user-agent'] || '', req.headers);
        // Country: expect ISO 3166-1 alpha-2 (2 uppercase letters) from edge headers.
        // Fallback to 'Unknown' — NOT sliced from a longer string — to avoid 'UN' artefacts.
        const rawCountry = req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry'] || '';
        const country    = rawCountry.length === 2 ? rawCountry.toUpperCase() : 'Unknown';

        const entry = {
            id:             randomUUID(),
            ts:             now.toISOString(),          // UTC timestamp
            visitor_id:     String(visitor_id),
            session_id:     String(session_id),
            page:           safePage,
            event:          eventKey,
            is_new_visitor: Boolean(is_new_visitor),
            props:          safeProps,
            device,
            browser,
            country,
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
        const _tok = extractToken(req);
        if (_tok && await isRevoked(_tok)) return res.status(401).json({ error: 'Unauthorized' });

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
