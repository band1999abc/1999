/**
 * Vercel Serverless Function: /api/flyer/:id
 *
 * GET    — serve flyer image (public)
 * PUT    — upload/replace flyer (auth required); body: { dataUrl: "data:image/...;base64,..." }
 * DELETE — remove flyer (auth required)
 */

import { COOKIE_NAME, verifyToken, parseCookies } from '../_auth.js';
import { readJsonArray, writeJsonArray, readFlyer, writeFlyer, deleteFlyer } from '../_storage.js';

const LIVES_FILE = 'data/lives.json';
// ~4MB base64 ≈ ~3MB image — stays within Vercel's 4.5MB body limit
const MAX_BYTES = 4 * 1024 * 1024;

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

export default async function handler(req, res) {
    const { id } = req.query;

    // ── GET /api/flyer/:id ────────────────────────────────────────────────────
    if (req.method === 'GET') {
        // Enforce same publish/auth guard as /api/live/:id
        const lives = await readJsonArray(LIVES_FILE);
        const live  = lives.find(l => l.id === id);
        if (!live) return res.status(404).send('Not found');
        if (live.status !== 'published' && !isAuthed(req))
            return res.status(404).send('Not found');

        const dataUrl = await readFlyer(id);
        if (!dataUrl) return res.status(404).send('Not found');

        const sep = ';base64,';
        const sepIdx = dataUrl.indexOf(sep);
        if (!dataUrl.startsWith('data:') || sepIdx < 0)
            return res.status(500).send('Invalid stored image data');

        const mimeType = dataUrl.slice(5, sepIdx);
        const data     = Buffer.from(dataUrl.slice(sepIdx + sep.length), 'base64');
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(data);
    }

    // ── PUT /api/flyer/:id ────────────────────────────────────────────────────
    if (req.method === 'PUT') {
        if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

        let body;
        try { body = await readBody(req); }
        catch (e) { return res.status(413).json({ error: 'Image too large (max ~3 MB)' }); }

        const { dataUrl } = body;
        if (!dataUrl || typeof dataUrl !== 'string')
            return res.status(400).json({ error: 'Missing dataUrl' });
        if (!dataUrl.startsWith('data:image/'))
            return res.status(400).json({ error: 'dataUrl must be an image' });
        if (!dataUrl.includes(';base64,'))
            return res.status(400).json({ error: 'dataUrl must be base64 encoded' });

        // Verify live exists, then store flyer and set live.flyer = true
        const lives = await readJsonArray(LIVES_FILE);
        const idx   = lives.findIndex(l => l.id === id);
        if (idx < 0) return res.status(404).json({ error: 'Live not found' });

        try {
            await writeFlyer(id, dataUrl);
            lives[idx] = { ...lives[idx], flyer: true, updatedAt: new Date().toISOString() };
            await writeJsonArray(LIVES_FILE, lives);
        } catch (e) {
            console.error('[flyer] PUT error:', e);
            return res.status(500).json({ error: 'Failed to save flyer' });
        }

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ ok: true });
    }

    // ── DELETE /api/flyer/:id ─────────────────────────────────────────────────
    if (req.method === 'DELETE') {
        if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

        try {
            await deleteFlyer(id);
            const lives = await readJsonArray(LIVES_FILE);
            const idx   = lives.findIndex(l => l.id === id);
            if (idx >= 0) {
                lives[idx] = { ...lives[idx], flyer: false, updatedAt: new Date().toISOString() };
                await writeJsonArray(LIVES_FILE, lives);
            }
        } catch (e) {
            console.error('[flyer] DELETE error:', e);
            return res.status(500).json({ error: 'Failed to delete flyer' });
        }

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
