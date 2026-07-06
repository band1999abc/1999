/**
 * Vercel Serverless Function: /api/flyer/:id
 *
 * GET    /api/flyer/:id           — serve first image (backward compat)
 * GET    /api/flyer/:id?s=SLOT    — serve specific slot image
 * POST   /api/flyer/:id           — add new image; body: { dataUrl }
 * PUT    /api/flyer/:id           — backward compat: set slot '0'
 * DELETE /api/flyer/:id?s=SLOT    — remove specific slot
 * DELETE /api/flyer/:id           — remove ALL slots (used by deleteLive)
 */

import { COOKIE_NAME, verifyToken, parseCookies } from '../_auth.js';
import {
    readJsonArray, writeJsonArray,
    readFlyerSlot, writeFlyerSlot, deleteFlyerSlot, deleteAllFlyerSlots,
} from '../_storage.js';

const LIVES_FILE = 'data/lives.json';
// ~4 MB base64 ≈ ~3 MB image — stays within Vercel's 4.5 MB body limit
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readBody(req) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        total += chunk.length;
        if (total > MAX_BYTES) throw new Error('Request body too large');
        chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { return {}; }
}

function isAuthed(req) {
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
        if (verifyToken(auth.slice(7)) !== null) return true;
    }
    const cookies = parseCookies(req.headers.cookie);
    return verifyToken(cookies[COOKIE_NAME] || '') !== null;
}

/**
 * Normalise live.flyer to a string array of slot IDs.
 * Handles legacy boolean values:
 *   false / null / undefined → []
 *   true                     → ['0']   (legacy single-image format)
 *   string[]                 → as-is
 */
function normalizeImages(live) {
    const f = live.flyer;
    if (!f) return [];
    if (f === true) return ['0'];
    if (Array.isArray(f)) return f;
    return [];
}

/** Serve a flyer image given a data URL stored in KV/FS */
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

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
    const { id, s: slotParam } = req.query;

    const lives = await readJsonArray(LIVES_FILE);
    const idx   = lives.findIndex(l => l.id === id);

    // ── GET /api/flyer/:id[?s=SLOT] ───────────────────────────────────────────
    if (req.method === 'GET') {
        if (idx < 0) return res.status(404).send('Not found');
        const live = lives[idx];

        // Auth guard: draft entries only visible to admins
        if (live.status !== 'published' && !isAuthed(req))
            return res.status(404).send('Not found');

        const images = normalizeImages(live);
        if (images.length === 0) return res.status(404).send('Not found');

        // Determine which slot to serve
        const slotId = slotParam || images[0];
        // Security: only serve slots that are registered in live.flyer
        if (!images.includes(slotId))
            return res.status(404).send('Not found');

        const dataUrl = await readFlyerSlot(id, slotId);
        if (!dataUrl) return res.status(404).send('Not found');

        return serveDataUrl(res, dataUrl);
    }

    // All write operations require auth
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

    // ── POST /api/flyer/:id — add new image ───────────────────────────────────
    if (req.method === 'POST') {
        if (idx < 0) return res.status(404).json({ error: 'Live not found' });

        let body;
        try { body = await readBody(req); }
        catch { return res.status(413).json({ error: 'Image too large (max ~3 MB)' }); }

        const { dataUrl } = body;
        if (!dataUrl || typeof dataUrl !== 'string')
            return res.status(400).json({ error: 'Missing dataUrl' });
        if (!dataUrl.startsWith('data:image/'))
            return res.status(400).json({ error: 'dataUrl must be an image' });
        if (!dataUrl.includes(';base64,'))
            return res.status(400).json({ error: 'dataUrl must be base64 encoded' });

        const currentImages = normalizeImages(lives[idx]);
        if (currentImages.length >= MAX_IMAGES)
            return res.status(400).json({ error: `画像は最大 ${MAX_IMAGES} 枚までです` });

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

    // ── PUT /api/flyer/:id — backward-compat: replace/set slot '0' ───────────
    if (req.method === 'PUT') {
        if (idx < 0) return res.status(404).json({ error: 'Live not found' });

        let body;
        try { body = await readBody(req); }
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

    // ── DELETE /api/flyer/:id[?s=SLOT] ───────────────────────────────────────
    if (req.method === 'DELETE') {
        if (idx < 0) return res.status(404).json({ error: 'Live not found' });

        const currentImages = normalizeImages(lives[idx]);

        if (slotParam) {
            // Delete specific slot
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

    return res.status(405).json({ error: 'Method not allowed' });
}
