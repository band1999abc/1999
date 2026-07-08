/**
 * Vercel Serverless Function: /api/[resource]
 *
 * Handles GET (list) and POST (create) for content resources.
 * Vercel sets req.query.resource to the matched path segment.
 *
 * Supported resources:
 *   diary  →  GET /api/diary,  POST /api/diary
 *   live   →  GET /api/live,   POST /api/live
 *
 * To add a new resource, define { GET, POST } handler functions below
 * and register them in HANDLERS — no new Vercel function needed.
 */

import { randomUUID } from 'crypto';
import { COOKIE_NAME, verifyToken, parseCookies, extractToken, isRevoked } from './_auth.js';
import { readJsonArray, writeJsonArray } from './_storage.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { return {}; }
}

function isAuthed(req) {
    // Resolved once at the top of handler(); reads req._authed set there.
    return req._authed === true;
}

// ── Shared regex ──────────────────────────────────────────────────────────────

const DATE_RE  = /^\d{4}-\d{2}-\d{2}$/;
const SCHED_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const TIME_RE  = /^\d{1,2}:\d{2}$/;

// ── Audio metadata helpers ────────────────────────────────────────────────────

/** Coerce to a finite, non-negative number ≤ max, or null if invalid. */
function sanitizeNum(val, max) {
    if (val == null) return null;
    const n = Number(val);
    return (isFinite(n) && n >= 0 && n <= max) ? n : null;
}

/** Validate an ISO-8601 datetime string; return the string or null. */
function sanitizeIso(val) {
    if (!val) return null;
    const s = String(val);
    return (!isNaN(new Date(s).getTime())) ? s : null;
}

// ── Diary ─────────────────────────────────────────────────────────────────────

const DIARY_FILE = 'data/diary.json';

/** Current Japan time as 'YYYY-MM-DDTHH:MM' (JST = UTC+9). */
function nowJST() {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
}

/** Promote 'scheduled' posts whose scheduledAt has passed. Returns true if any changed. */
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

async function diaryList(req, res) {
    let posts = await readJsonArray(DIARY_FILE);
    if (autoPromote(posts)) {
        await writeJsonArray(DIARY_FILE, posts).catch(e =>
            console.error('[diary] auto-promote save error:', e)
        );
    }
    if (!isAuthed(req)) posts = posts.filter(p => p.status === 'published');
    posts.sort((a, b) => {
        const da = (b.date || '') + (b.scheduledAt || '');
        const db = (a.date || '') + (a.scheduledAt || '');
        return da.localeCompare(db);
    });
    return res.status(200).json(posts);
}

async function diaryCreate(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

    const body = await readBody(req);
    const { title = '', body: text = '', date, status = 'draft', scheduledAt = '' } = body;

    if (date && !DATE_RE.test(String(date)))
        return res.status(400).json({ error: 'Invalid date format; expected YYYY-MM-DD' });

    const validStatuses  = ['published', 'draft', 'scheduled'];
    const safeStatus     = validStatuses.includes(status) ? status : 'draft';
    const safeScheduledAt = String(scheduledAt || '').trim();

    if (safeStatus === 'scheduled') {
        if (!safeScheduledAt || !SCHED_RE.test(safeScheduledAt))
            return res.status(400).json({ error: 'scheduledAt required (YYYY-MM-DDTHH:MM)' });
        if (safeScheduledAt <= nowJST())
            return res.status(400).json({ error: 'scheduledAt must be in the future' });
    }

    const now  = new Date().toISOString();
    const post = {
        id:          randomUUID(),
        title:       String(title).trim(),
        body:        String(text).trim(),
        date:        (date && DATE_RE.test(String(date))) ? String(date) : now.slice(0, 10),
        status:      safeStatus,
        scheduledAt: safeStatus === 'scheduled' ? safeScheduledAt : '',
        createdAt:   now,
        updatedAt:   now,
    };

    try {
        const posts = await readJsonArray(DIARY_FILE);
        posts.unshift(post);
        await writeJsonArray(DIARY_FILE, posts);
    } catch (e) {
        console.error('[diary] save error:', e);
        return res.status(500).json({ error: 'Failed to save' });
    }
    return res.status(201).json(post);
}

// ── Live ──────────────────────────────────────────────────────────────────────

const LIVES_FILE = 'data/lives.json';

function validTime(s) {
    const str = String(s || '').trim();
    return TIME_RE.test(str) ? str : '';
}

async function liveList(req, res) {
    let lives = await readJsonArray(LIVES_FILE);
    if (!isAuthed(req)) lives = lives.filter(l => l.status === 'published');
    return res.status(200).json(lives);
}

async function liveCreate(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

    const body = await readBody(req);
    const { date, venue = '', open = '', start = '', ticket = '', status = 'draft', sort_order } = body;

    if (date && !DATE_RE.test(String(date)))
        return res.status(400).json({ error: 'Invalid date format; expected YYYY-MM-DD' });
    if (sort_order !== undefined && !Number.isFinite(Number(sort_order)))
        return res.status(400).json({ error: 'sort_order must be an integer' });

    const lives    = await readJsonArray(LIVES_FILE);
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

    try {
        lives.push(live);
        await writeJsonArray(LIVES_FILE, lives);
    } catch (e) {
        console.error('[live] save error:', e);
        return res.status(500).json({ error: 'Failed to save' });
    }
    return res.status(201).json(live);
}

// ── Music ─────────────────────────────────────────────────────────────────────

const MUSIC_FILE = 'data/music.json';

const MUSIC_VALID_STATUSES = ['published', 'draft', 'scheduled'];
const MUSIC_VALID_TYPES    = ['single', 'ep', 'album'];

function autoPromoteMusic(items) {
    const now = nowJST();
    let changed = false;
    for (const t of items) {
        if (t.status === 'scheduled' && t.scheduledAt && t.scheduledAt <= now) {
            t.status    = 'published';
            t.updatedAt = new Date().toISOString();
            changed     = true;
        }
    }
    return changed;
}

async function musicList(req, res) {
    let items = await readJsonArray(MUSIC_FILE);
    if (autoPromoteMusic(items)) {
        await writeJsonArray(MUSIC_FILE, items).catch(e =>
            console.error('[music] auto-promote error:', e)
        );
    }
    if (!isAuthed(req)) items = items.filter(t => t.status === 'published');
    items.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));
    return res.status(200).json(items);
}

async function musicCreate(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

    const body = await readBody(req);
    const {
        title = '', titleEn = '', releaseDate, type = 'single',
        status = 'draft', scheduledAt = '',
        audioUrl = '', lyrics = '', productionNote = '',
        duration, fileSize, bitrate, uploadedAt,
    } = body;

    if (!String(title).trim())
        return res.status(400).json({ error: 'title is required' });
    if (releaseDate && !DATE_RE.test(String(releaseDate)))
        return res.status(400).json({ error: 'Invalid releaseDate format; expected YYYY-MM-DD' });

    const safeStatus = MUSIC_VALID_STATUSES.includes(status) ? status : 'draft';
    const safeSched  = String(scheduledAt || '').trim();
    if (safeStatus === 'scheduled' && (!safeSched || !SCHED_RE.test(safeSched)))
        return res.status(400).json({ error: 'scheduledAt required (YYYY-MM-DDTHH:MM)' });

    const now   = new Date().toISOString();
    const track = {
        id:             randomUUID(),
        title:          String(title).trim(),
        titleEn:        String(titleEn || '').trim(),
        releaseDate:    (releaseDate && DATE_RE.test(String(releaseDate))) ? String(releaseDate) : '',
        type:           MUSIC_VALID_TYPES.includes(type) ? type : 'single',
        status:         safeStatus,
        scheduledAt:    safeStatus === 'scheduled' ? safeSched : '',
        jacket:         false,
        audioFile:      false,
        audioUrl:       String(audioUrl || '').trim(),
        lyrics:         String(lyrics   || ''),
        productionNote: String(productionNote || ''),
        duration:       sanitizeNum(duration,  86400),   // max 24h in seconds
        fileSize:       sanitizeNum(fileSize,  2e9),     // max ~2 GB
        bitrate:        sanitizeNum(bitrate,   10000),   // max 10 000 kbps
        uploadedAt:     sanitizeIso(uploadedAt),
        createdAt:      now,
        updatedAt:      now,
    };

    try {
        const items = await readJsonArray(MUSIC_FILE);
        items.unshift(track);
        await writeJsonArray(MUSIC_FILE, items);
    } catch (e) {
        console.error('[music] create error:', e);
        return res.status(500).json({ error: 'Failed to save' });
    }
    return res.status(201).json(track);
}

// ── Messages ──────────────────────────────────────────────────────────────────

const MESSAGES_FILE = 'data/messages.json';

const MSG_VALID_SLOTS   = ['dawn', 'morning', 'midday', 'afternoon', 'evening', 'latenight'];
const MSG_VALID_SEASONS = ['spring', 'rainy', 'summer', 'autumn', 'winter'];
const MSG_VALID_WEATHER = ['clear', 'cloudy', 'rain', 'snow', 'thunder', 'foggy'];
const MSG_VALID_SPECIAL = ['rare', 'live_today', 'live_tomorrow', 'new_release', 'anniversary'];

function cleanMsgCond(raw) {
    const c = (raw && typeof raw === 'object') ? raw : {};
    return {
        timeSlots: (Array.isArray(c.timeSlots) ? c.timeSlots : []).filter(v => MSG_VALID_SLOTS.includes(v)),
        seasons:   (Array.isArray(c.seasons)   ? c.seasons   : []).filter(v => MSG_VALID_SEASONS.includes(v)),
        weather:   (Array.isArray(c.weather)   ? c.weather   : []).filter(v => MSG_VALID_WEATHER.includes(v)),
        special:   (Array.isArray(c.special)   ? c.special   : []).filter(v => MSG_VALID_SPECIAL.includes(v)),
    };
}

async function messagesList(req, res) {
    const authed = isAuthed(req);
    let items = await readJsonArray(MESSAGES_FILE);
    if (!authed) items = items.filter(m => m.enabled !== false);
    return res.status(200).json(items);
}

async function messagesCreate(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
    const body = await readBody(req);
    const { ja = '', en = '', enabled = true, priority = 3, conditions } = body;
    if (!String(ja).trim()) return res.status(400).json({ error: 'ja is required' });
    const now = new Date().toISOString();
    const msg = {
        id:         randomUUID(),
        ja:         String(ja).trim(),
        en:         String(en || '').trim(),
        enabled:    enabled !== false,
        priority:   Math.min(5, Math.max(1, parseInt(priority, 10) || 3)),
        conditions: cleanMsgCond(conditions),
        createdAt:  now,
        updatedAt:  now,
    };
    try {
        const items = await readJsonArray(MESSAGES_FILE);
        items.push(msg);
        await writeJsonArray(MESSAGES_FILE, items);
    } catch (e) {
        console.error('[messages] create error:', e);
        return res.status(500).json({ error: 'Failed to save' });
    }
    return res.status(201).json(msg);
}

// ── Resource router ───────────────────────────────────────────────────────────
//
// Add new resources here. Each entry is a { GET?, POST? } map of method handlers.
// Unknown resources → 404. Unknown methods → 405.

const HANDLERS = {
    diary:    { GET: diaryList,    POST: diaryCreate    },
    live:     { GET: liveList,     POST: liveCreate     },
    music:    { GET: musicList,    POST: musicCreate    },
    messages: { GET: messagesList, POST: messagesCreate },
};

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    // Resolve auth once — includes denylist check — so all sub-handlers can
    // call the synchronous isAuthed(req) without extra async work.
    const _tok   = extractToken(req);
    req._authed  = verifyToken(_tok) !== null && !(await isRevoked(_tok));

    const resource = req.query?.resource;
    const methods  = HANDLERS[resource];
    if (!methods) return res.status(404).json({ error: 'Not found' });

    const fn = methods[req.method];
    if (!fn)  return res.status(405).json({ error: 'Method not allowed' });

    return fn(req, res);
}
