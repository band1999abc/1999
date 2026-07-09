/**
 * Vercel Serverless Function: /api/[resource]/[id]
 *
 * Handles GET/PUT/DELETE for individual content items.
 * Vercel sets req.query.resource and req.query.id.
 *
 * Supported resources:
 *   diary/:id  →  GET /api/diary/:id,  PUT /api/diary/:id,  DELETE /api/diary/:id
 *   live/:id   →  GET /api/live/:id,   PUT /api/live/:id,   DELETE /api/live/:id
 *   flyer/:id  →  GET /api/flyer/:id,  POST /api/flyer/:id, PUT /api/flyer/:id,
 *                 DELETE /api/flyer/:id[?s=SLOT]
 *
 * To add a new resource, define handler functions below and register them
 * in HANDLERS — no new Vercel function needed.
 */

import { COOKIE_NAME, verifyToken, parseCookies, extractToken, isRevoked } from '../_auth.js';
import {
    readJsonArray, writeJsonArray,
    readFlyerSlot, writeFlyerSlot, deleteFlyerSlot, deleteAllFlyerSlots,
    readMusicJacket, writeMusicJacket, deleteMusicJacket,
    readMusicFile, writeMusicFile, deleteMusicFile,
} from '../_storage.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { return {}; }
}

/** readBody with a hard size cap (for flyer image uploads). Throws on overflow. */
async function readBodyLimited(req, maxBytes) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        total += chunk.length;
        if (total > maxBytes) throw new Error('Request body too large');
        chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { return {}; }
}

/** readBody as raw Buffer with a size cap. Throws on overflow. */
async function readBodyLimitedRaw(req, maxBytes) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        total += chunk.length;
        if (total > maxBytes) throw new Error('Request body too large');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
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

function nowJST() {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
}

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

async function diaryGet(req, res) {
    const { id } = req.query;
    const posts  = await readJsonArray(DIARY_FILE);

    if (autoPromote(posts)) {
        await writeJsonArray(DIARY_FILE, posts).catch(e =>
            console.error('[diary/id] auto-promote save error:', e)
        );
    }

    const idx = posts.findIndex(p => p.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Not found' });

    const post = posts[idx];
    if (post.status !== 'published' && !isAuthed(req))
        return res.status(404).json({ error: 'Not found' });

    return res.status(200).json(post);
}

async function diaryPut(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;
    const posts  = await readJsonArray(DIARY_FILE);
    const idx    = posts.findIndex(p => p.id === id);
    if (idx < 0)  return res.status(404).json({ error: 'Not found' });

    const body = await readBody(req);
    const { title, body: text, date, status, scheduledAt } = body;
    const prev = posts[idx];

    if (date !== undefined && !DATE_RE.test(String(date)))
        return res.status(400).json({ error: 'Invalid date format; expected YYYY-MM-DD' });

    const validStatuses = ['published', 'draft', 'scheduled'];
    const safeStatus    = status && validStatuses.includes(status) ? status : prev.status;

    const rawSched = scheduledAt !== undefined
        ? String(scheduledAt).trim()
        : (prev.scheduledAt || '');
    if (safeStatus === 'scheduled') {
        if (!rawSched || !SCHED_RE.test(rawSched))
            return res.status(400).json({ error: 'scheduledAt required (YYYY-MM-DDTHH:MM)' });
        if (rawSched <= nowJST())
            return res.status(400).json({ error: 'scheduledAt must be in the future' });
    }

    const updated = {
        ...prev,
        title:       title !== undefined ? String(title).trim() : prev.title,
        body:        text  !== undefined ? String(text).trim()  : prev.body,
        date:        date  !== undefined ? String(date)         : prev.date,
        status:      safeStatus,
        scheduledAt: safeStatus === 'scheduled' ? rawSched : '',
        updatedAt:   new Date().toISOString(),
    };

    try {
        posts[idx] = updated;
        await writeJsonArray(DIARY_FILE, posts);
    } catch (e) {
        console.error('[diary] update error:', e);
        return res.status(500).json({ error: 'Failed to save' });
    }
    return res.status(200).json(updated);
}

async function diaryDelete(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;
    const posts  = await readJsonArray(DIARY_FILE);
    const idx    = posts.findIndex(p => p.id === id);
    if (idx < 0)  return res.status(404).json({ error: 'Not found' });

    try {
        posts.splice(idx, 1);
        await writeJsonArray(DIARY_FILE, posts);
    } catch (e) {
        console.error('[diary] delete error:', e);
        return res.status(500).json({ error: 'Failed to delete' });
    }
    return res.status(200).json({ ok: true });
}

// ── Live ──────────────────────────────────────────────────────────────────────

const LIVES_FILE = 'data/lives.json';

function validTime(s) {
    const str = String(s || '').trim();
    return TIME_RE.test(str) ? str : '';
}

async function liveGet(req, res) {
    const { id } = req.query;
    const lives  = await readJsonArray(LIVES_FILE);
    const idx    = lives.findIndex(l => l.id === id);
    if (idx < 0)  return res.status(404).json({ error: 'Not found' });

    const live = lives[idx];
    if (live.status !== 'published' && !isAuthed(req))
        return res.status(404).json({ error: 'Not found' });

    return res.status(200).json(live);
}

async function livePut(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;
    const lives  = await readJsonArray(LIVES_FILE);
    const idx    = lives.findIndex(l => l.id === id);
    if (idx < 0)  return res.status(404).json({ error: 'Not found' });

    const body = await readBody(req);
    const { date, venue, open, start, ticket, status, sort_order } = body;
    const prev = lives[idx];

    if (date !== undefined && !DATE_RE.test(String(date)))
        return res.status(400).json({ error: 'Invalid date format; expected YYYY-MM-DD' });
    if (sort_order !== undefined && !Number.isFinite(Number(sort_order)))
        return res.status(400).json({ error: 'sort_order must be an integer' });

    const updated = {
        ...prev,
        date:       date       !== undefined ? String(date)          : prev.date,
        venue:      venue      !== undefined ? String(venue).trim()  : prev.venue,
        open:       open       !== undefined ? validTime(open)       : prev.open,
        start:      start      !== undefined ? validTime(start)      : prev.start,
        ticket:     ticket     !== undefined ? String(ticket).trim() : prev.ticket,
        status:     status && ['published', 'draft'].includes(status) ? status : prev.status,
        sort_order: sort_order !== undefined ? Number(sort_order)    : prev.sort_order,
        updatedAt:  new Date().toISOString(),
    };

    try {
        lives[idx] = updated;
        await writeJsonArray(LIVES_FILE, lives);
    } catch (e) {
        console.error('[live] update error:', e);
        return res.status(500).json({ error: 'Failed to save' });
    }
    return res.status(200).json(updated);
}

async function liveDelete(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;
    const lives  = await readJsonArray(LIVES_FILE);
    const idx    = lives.findIndex(l => l.id === id);
    if (idx < 0)  return res.status(404).json({ error: 'Not found' });

    try {
        lives.splice(idx, 1);
        await writeJsonArray(LIVES_FILE, lives);
    } catch (e) {
        console.error('[live] delete error:', e);
        return res.status(500).json({ error: 'Failed to delete' });
    }
    return res.status(200).json({ ok: true });
}

// ── Flyer ─────────────────────────────────────────────────────────────────────

// ~4 MB base64 ≈ ~3 MB image — stays within Vercel's 4.5 MB body limit
const FLYER_MAX_BYTES  = 4 * 1024 * 1024;
const FLYER_MAX_IMAGES = 20;

/**
 * Normalise live.flyer to a string array of slot IDs.
 * Handles legacy boolean values:
 *   false / null / undefined → []
 *   true                     → ['0']  (legacy single-image format)
 *   string[]                 → as-is
 */
function normalizeImages(live) {
    const f = live.flyer;
    if (!f) return [];
    if (f === true) return ['0'];
    if (Array.isArray(f)) return f;
    return [];
}

function serveDataUrl(res, dataUrl) {
    const sep    = ';base64,';
    const sepIdx = dataUrl.indexOf(sep);
    if (!dataUrl.startsWith('data:') || sepIdx < 0)
        return res.status(500).send('Invalid stored image data');
    const mimeType = dataUrl.slice(5, sepIdx);
    const data     = Buffer.from(dataUrl.slice(sepIdx + sep.length), 'base64');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(data);
}

async function flyerGet(req, res) {
    const { id, s: slotParam } = req.query;
    const lives = await readJsonArray(LIVES_FILE);
    const idx   = lives.findIndex(l => l.id === id);
    if (idx < 0) return res.status(404).send('Not found');

    const live = lives[idx];
    if (live.status !== 'published' && !isAuthed(req))
        return res.status(404).send('Not found');

    const images = normalizeImages(live);
    if (images.length === 0) return res.status(404).send('Not found');

    const slotId = slotParam || images[0];
    if (!images.includes(slotId)) return res.status(404).send('Not found');

    const dataUrl = await readFlyerSlot(id, slotId);
    if (!dataUrl) return res.status(404).send('Not found');

    return serveDataUrl(res, dataUrl);
}

async function flyerPost(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;
    const lives  = await readJsonArray(LIVES_FILE);
    const idx    = lives.findIndex(l => l.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Live not found' });

    let body;
    try { body = await readBodyLimited(req, FLYER_MAX_BYTES); }
    catch { return res.status(413).json({ error: 'Image too large (max ~3 MB)' }); }

    const { dataUrl } = body;
    if (!dataUrl || typeof dataUrl !== 'string')
        return res.status(400).json({ error: 'Missing dataUrl' });
    if (!dataUrl.startsWith('data:image/'))
        return res.status(400).json({ error: 'dataUrl must be an image' });
    if (!dataUrl.includes(';base64,'))
        return res.status(400).json({ error: 'dataUrl must be base64 encoded' });

    const currentImages = normalizeImages(lives[idx]);
    if (currentImages.length >= FLYER_MAX_IMAGES)
        return res.status(400).json({ error: `画像は最大 ${FLYER_MAX_IMAGES} 枚までです` });

    const slotId = Math.random().toString(36).slice(2, 8);
    try {
        await writeFlyerSlot(id, slotId, dataUrl);
    } catch (e) {
        console.error('[flyer] POST write error:', e);
        return res.status(500).json({ error: 'Failed to save image' });
    }

    const newImages = [...currentImages, slotId];
    lives[idx] = { ...lives[idx], flyer: newImages, updatedAt: new Date().toISOString() };
    await writeJsonArray(LIVES_FILE, lives);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, slotId, images: newImages });
}

async function flyerPut(req, res) {
    // Backward compat: replace/set slot '0'
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;
    const lives  = await readJsonArray(LIVES_FILE);
    const idx    = lives.findIndex(l => l.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Live not found' });

    let body;
    try { body = await readBodyLimited(req, FLYER_MAX_BYTES); }
    catch { return res.status(413).json({ error: 'Image too large (max ~3 MB)' }); }

    const { dataUrl } = body;
    if (!dataUrl || typeof dataUrl !== 'string')
        return res.status(400).json({ error: 'Missing dataUrl' });
    if (!dataUrl.startsWith('data:image/'))
        return res.status(400).json({ error: 'dataUrl must be an image' });

    const currentImages = normalizeImages(lives[idx]);
    try {
        await writeFlyerSlot(id, '0', dataUrl);
    } catch (e) {
        return res.status(500).json({ error: 'Failed to save image' });
    }

    const newImages = currentImages.includes('0') ? currentImages : ['0', ...currentImages];
    lives[idx] = { ...lives[idx], flyer: newImages, updatedAt: new Date().toISOString() };
    await writeJsonArray(LIVES_FILE, lives);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, images: newImages });
}

async function flyerDelete(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

    const { id, s: slotParam } = req.query;
    const lives = await readJsonArray(LIVES_FILE);
    const idx   = lives.findIndex(l => l.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Live not found' });

    const currentImages = normalizeImages(lives[idx]);

    if (slotParam) {
        if (!currentImages.includes(slotParam))
            return res.status(404).json({ error: 'Slot not found' });
        try {
            await deleteFlyerSlot(id, slotParam);
        } catch (e) {
            console.error('[flyer] DELETE slot error:', e);
            return res.status(500).json({ error: 'Failed to delete image' });
        }
        const newImages = currentImages.filter(s => s !== slotParam);
        lives[idx] = { ...lives[idx], flyer: newImages, updatedAt: new Date().toISOString() };
        await writeJsonArray(LIVES_FILE, lives);

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ ok: true, images: newImages });
    }

    // No slot param — delete ALL images (used by deleteLive)
    try {
        await deleteAllFlyerSlots(id, currentImages);
    } catch (e) {
        console.error('[flyer] DELETE all error:', e);
        return res.status(500).json({ error: 'Failed to delete images' });
    }

    lives[idx] = { ...lives[idx], flyer: [], updatedAt: new Date().toISOString() };
    await writeJsonArray(LIVES_FILE, lives);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, images: [] });
}

// ── Music ─────────────────────────────────────────────────────────────────────

const MUSIC_FILE = 'data/music.json';

const MUSIC_VALID_STATUSES = ['published', 'draft', 'scheduled'];
const MUSIC_VALID_TYPES    = ['single', 'ep', 'album'];

function nowJSTMusic() {
    const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 16);
}

function autoPromoteMusic(items) {
    const now = nowJSTMusic();
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

async function musicGet(req, res) {
    const { id } = req.query;
    const items  = await readJsonArray(MUSIC_FILE);
    if (autoPromoteMusic(items)) {
        await writeJsonArray(MUSIC_FILE, items).catch(e =>
            console.error('[music/id] auto-promote error:', e)
        );
    }
    const t = items.find(x => x.id === id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (t.status !== 'published' && !isAuthed(req))
        return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(t);
}

async function musicPut(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;
    const items  = await readJsonArray(MUSIC_FILE);
    const idx    = items.findIndex(x => x.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Not found' });

    const body = await readBody(req);
    const {
        title, titleEn, releaseDate, type, status,
        scheduledAt, audioUrl, lyrics, productionNote,
        duration, fileSize, bitrate, uploadedAt,
    } = body;
    const prev = items[idx];

    if (title !== undefined && !String(title).trim())
        return res.status(400).json({ error: 'title cannot be empty' });
    if (releaseDate !== undefined && releaseDate && !DATE_RE.test(String(releaseDate)))
        return res.status(400).json({ error: 'Invalid releaseDate format' });

    const safeStatus = status && MUSIC_VALID_STATUSES.includes(status) ? status : prev.status;
    const rawSched   = scheduledAt !== undefined ? String(scheduledAt).trim() : (prev.scheduledAt || '');
    if (safeStatus === 'scheduled' && (!rawSched || !SCHED_RE.test(rawSched)))
        return res.status(400).json({ error: 'scheduledAt required (YYYY-MM-DDTHH:MM)' });

    const updated = {
        ...prev,
        title:          title          !== undefined ? String(title).trim()          : prev.title,
        titleEn:        titleEn        !== undefined ? String(titleEn).trim()        : (prev.titleEn || ''),
        releaseDate:    releaseDate    !== undefined ? String(releaseDate)            : prev.releaseDate,
        type:           type && MUSIC_VALID_TYPES.includes(type) ? type             : (prev.type || 'single'),
        status:         safeStatus,
        scheduledAt:    safeStatus === 'scheduled' ? rawSched                        : '',
        audioUrl:       audioUrl       !== undefined ? String(audioUrl).trim()       : (prev.audioUrl || ''),
        lyrics:         lyrics         !== undefined ? String(lyrics)                : (prev.lyrics || ''),
        productionNote: productionNote !== undefined ? String(productionNote)        : (prev.productionNote || ''),
        duration:       duration   !== undefined ? sanitizeNum(duration,  86400) : (prev.duration  ?? null),
        fileSize:       fileSize   !== undefined ? sanitizeNum(fileSize,  2e9)   : (prev.fileSize  ?? null),
        bitrate:        bitrate    !== undefined ? sanitizeNum(bitrate,   10000) : (prev.bitrate   ?? null),
        uploadedAt:     uploadedAt !== undefined ? sanitizeIso(uploadedAt)       : (prev.uploadedAt ?? null),
        audioFile:      prev.audioFile ?? false,   // managed by /api/music-file/:id only
        updatedAt:      new Date().toISOString(),
    };

    try {
        items[idx] = updated;
        await writeJsonArray(MUSIC_FILE, items);
    } catch (e) {
        console.error('[music] update error:', e);
        return res.status(500).json({ error: 'Failed to save' });
    }
    return res.status(200).json(updated);
}

async function musicDelete(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;
    const items  = await readJsonArray(MUSIC_FILE);
    const idx    = items.findIndex(x => x.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Not found' });

    try {
        items.splice(idx, 1);
        await writeJsonArray(MUSIC_FILE, items);
        // Best-effort jacket cleanup
        await deleteMusicJacket(id).catch(() => {});
    } catch (e) {
        console.error('[music] delete error:', e);
        return res.status(500).json({ error: 'Failed to delete' });
    }
    return res.status(200).json({ ok: true });
}

// ── Music jacket ──────────────────────────────────────────────────────────────

const JACKET_MAX_BYTES = 4 * 1024 * 1024;   // 4 MB

async function musicJacketGet(req, res) {
    const { id } = req.query;
    const items  = await readJsonArray(MUSIC_FILE);
    const t      = items.find(x => x.id === id);
    if (!t) return res.status(404).send('Not found');
    if (t.status !== 'published' && !isAuthed(req))
        return res.status(404).send('Not found');

    const dataUrl = await readMusicJacket(id);
    if (!dataUrl) return res.status(404).send('Not found');

    return serveDataUrl(res, dataUrl);
}

async function musicJacketPost(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;
    const items  = await readJsonArray(MUSIC_FILE);
    const idx    = items.findIndex(x => x.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Track not found' });

    let body;
    try { body = await readBodyLimited(req, JACKET_MAX_BYTES); }
    catch { return res.status(413).json({ error: 'Image too large (max ~3 MB)' }); }

    const { dataUrl } = body;
    if (!dataUrl || typeof dataUrl !== 'string')
        return res.status(400).json({ error: 'Missing dataUrl' });
    if (!dataUrl.startsWith('data:image/'))
        return res.status(400).json({ error: 'dataUrl must be an image' });
    if (!dataUrl.includes(';base64,'))
        return res.status(400).json({ error: 'dataUrl must be base64 encoded' });

    try {
        await writeMusicJacket(id, dataUrl);
    } catch (e) {
        console.error('[music-jacket] write error:', e);
        return res.status(500).json({ error: 'Failed to save image' });
    }

    items[idx] = { ...items[idx], jacket: true, updatedAt: new Date().toISOString() };
    await writeJsonArray(MUSIC_FILE, items);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true });
}

async function musicJacketDelete(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;
    const items  = await readJsonArray(MUSIC_FILE);
    const idx    = items.findIndex(x => x.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Track not found' });

    await deleteMusicJacket(id).catch(e =>
        console.error('[music-jacket] delete error:', e)
    );

    items[idx] = { ...items[idx], jacket: false, updatedAt: new Date().toISOString() };
    await writeJsonArray(MUSIC_FILE, items);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true });
}

// ── Music file (hosted MP3) ───────────────────────────────────────────────────

const FILE_MAX_BYTES = 8 * 1024 * 1024;   // 8 MB request body ≈ 6 MB raw audio

async function musicFileGet(req, res) {
    const { id } = req.query;
    const stored = await readMusicFile(id);
    if (!stored) return res.status(404).end();

    const comma  = stored.indexOf(',');
    const rawB64 = comma >= 0 ? stored.slice(comma + 1) : stored;
    const buf    = Buffer.from(rawB64, 'base64');
    const total  = buf.length;

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');

    const range = req.headers['range'];
    if (range) {
        const m = range.match(/bytes=(\d+)-(\d*)/);
        if (!m) {
            res.setHeader('Content-Range', `bytes */${total}`);
            return res.status(416).end();
        }
        const s = parseInt(m[1], 10);
        const e = m[2] !== '' ? parseInt(m[2], 10) : total - 1;
        if (s >= total || e >= total || s > e) {
            res.setHeader('Content-Range', `bytes */${total}`);
            return res.status(416).end();
        }
        res.setHeader('Content-Range',  `bytes ${s}-${e}/${total}`);
        res.setHeader('Content-Length', e - s + 1);
        return res.status(206).end(buf.slice(s, e + 1));
    }
    res.setHeader('Content-Length', total);
    return res.status(200).end(buf);
}

async function musicFilePost(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;
    const items  = await readJsonArray(MUSIC_FILE);
    const idx    = items.findIndex(x => x.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Track not found' });

    const ct = ((req.headers['content-type'] || '').toLowerCase().split(';')[0]).trim();
    let dataUrl;

    if (ct === 'application/json') {
        // Legacy: base64 JSON body {"dataUrl":"data:audio/...;base64,..."}
        let body;
        try { body = await readBodyLimited(req, FILE_MAX_BYTES); }
        catch { return res.status(413).json({ error: 'ファイルが大きすぎます（目安: 3MB 以下）' }); }
        dataUrl = body?.dataUrl;
        if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:audio/'))
            return res.status(400).json({ error: 'dataUrl (audio) が必要です' });
        if (!dataUrl.includes(';base64,'))
            return res.status(400).json({ error: 'dataUrl must be base64 encoded' });
    } else if (ct.startsWith('audio/') || ct === 'application/octet-stream') {
        // Binary upload — eliminates the 33 % base64 overhead vs JSON path
        let rawBuf;
        try { rawBuf = await readBodyLimitedRaw(req, FILE_MAX_BYTES); }
        catch { return res.status(413).json({ error: 'ファイルが大きすぎます（目安: 3MB 以下）' }); }
        if (!rawBuf.length) return res.status(400).json({ error: 'Empty body' });
        const mime = ct.startsWith('audio/') ? ct : 'audio/mpeg';
        dataUrl = 'data:' + mime + ';base64,' + rawBuf.toString('base64');
    } else {
        return res.status(400).json({ error: 'Content-Type が不正です' });
    }

    try {
        await writeMusicFile(id, dataUrl);
    } catch (e) {
        console.error('[music-file] write error:', e);
        return res.status(500).json({ error: 'Failed to save file' });
    }

    items[idx] = { ...items[idx], audioFile: true, updatedAt: new Date().toISOString() };
    await writeJsonArray(MUSIC_FILE, items);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true });
}

async function musicFileDelete(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.query;
    const items  = await readJsonArray(MUSIC_FILE);
    const idx    = items.findIndex(x => x.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Track not found' });

    await deleteMusicFile(id).catch(e => console.error('[music-file] delete error:', e));

    items[idx] = { ...items[idx], audioFile: false, updatedAt: new Date().toISOString() };
    await writeJsonArray(MUSIC_FILE, items);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true });
}

// ── Messages ──────────────────────────────────────────────────────────────────

const MESSAGES_FILE_ID     = 'data/messages.json';
const MSG_VALID_SLOTS_ID   = ['dawn', 'morning', 'midday', 'afternoon', 'evening', 'latenight'];
const MSG_VALID_SEASONS_ID = ['spring', 'rainy', 'summer', 'autumn', 'winter'];
const MSG_VALID_WEATHER_ID = ['clear', 'cloudy', 'rain', 'snow', 'thunder', 'foggy'];
const MSG_VALID_SPECIAL_ID = ['rare', 'live_today', 'live_tomorrow', 'new_release', 'anniversary'];

function cleanMsgCondId(raw) {
    const c = (raw && typeof raw === 'object') ? raw : {};
    return {
        timeSlots: (Array.isArray(c.timeSlots) ? c.timeSlots : []).filter(v => MSG_VALID_SLOTS_ID.includes(v)),
        seasons:   (Array.isArray(c.seasons)   ? c.seasons   : []).filter(v => MSG_VALID_SEASONS_ID.includes(v)),
        weather:   (Array.isArray(c.weather)   ? c.weather   : []).filter(v => MSG_VALID_WEATHER_ID.includes(v)),
        special:   (Array.isArray(c.special)   ? c.special   : []).filter(v => MSG_VALID_SPECIAL_ID.includes(v)),
    };
}

async function messageGet(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.query;
    const items  = await readJsonArray(MESSAGES_FILE_ID);
    const item   = items.find(m => m.id === id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(item);
}

async function messagePut(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.query;
    const items  = await readJsonArray(MESSAGES_FILE_ID);
    const idx    = items.findIndex(m => m.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Not found' });

    const body    = await readBody(req);
    const updated = { ...items[idx] };
    if (body.ja !== undefined) {
        if (!String(body.ja).trim()) return res.status(400).json({ error: 'ja cannot be empty' });
        updated.ja = String(body.ja).trim();
    }
    if (body.en         !== undefined) updated.en         = String(body.en || '').trim();
    if (body.enabled    !== undefined) updated.enabled    = body.enabled !== false;
    if (body.priority   !== undefined) updated.priority   = Math.min(5, Math.max(1, parseInt(body.priority, 10) || 3));
    if (body.conditions !== undefined) updated.conditions = cleanMsgCondId(body.conditions);
    updated.updatedAt = new Date().toISOString();

    items[idx] = updated;
    try {
        await writeJsonArray(MESSAGES_FILE_ID, items);
    } catch (e) {
        console.error('[messages] update error:', e);
        return res.status(500).json({ error: 'Failed to save' });
    }
    return res.status(200).json(updated);
}

async function messageDelete(req, res) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.query;
    const items  = await readJsonArray(MESSAGES_FILE_ID);
    const idx    = items.findIndex(m => m.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Not found' });
    items.splice(idx, 1);
    try {
        await writeJsonArray(MESSAGES_FILE_ID, items);
    } catch (e) {
        console.error('[messages] delete error:', e);
        return res.status(500).json({ error: 'Failed to save' });
    }
    return res.status(200).json({ ok: true });
}

// ── Resource router ───────────────────────────────────────────────────────────
//
// Add new resources here. Each entry is a map of HTTP method → handler.
// Unknown resources → 404. Unknown methods → 405.

const HANDLERS = {
    diary:        { GET: diaryGet,       PUT: diaryPut,       DELETE: diaryDelete                               },
    live:         { GET: liveGet,        PUT: livePut,        DELETE: liveDelete                               },
    flyer:        { GET: flyerGet,       POST: flyerPost,     PUT: flyerPut,  DELETE: flyerDelete              },
    music:        { GET: musicGet,       PUT: musicPut,       DELETE: musicDelete                              },
    'music-jacket': { GET: musicJacketGet, POST: musicJacketPost, DELETE: musicJacketDelete                    },
    'music-file':   { GET: musicFileGet,   POST: musicFilePost,   DELETE: musicFileDelete                       },
    messages:     { GET: messageGet,     PUT: messagePut,     DELETE: messageDelete                            },
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
