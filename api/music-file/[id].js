/**
 * Vercel Serverless Function: /api/music-file/[id]
 *
 * GET    /api/music-file/:id  — stream hosted MP3 (public, Range-aware)
 * POST   /api/music-file/:id  — upload MP3 as base64 data URL (auth required)
 * DELETE /api/music-file/:id  — remove hosted file (auth required)
 */

import { verifyToken, extractToken, isRevoked } from '../_auth.js';
import {
    readJsonArray, writeJsonArray,
    readMusicFile, writeMusicFile, deleteMusicFile,
} from '../_storage.js';

const MUSIC_FILE_PATH = 'data/music.json';
const FILE_MAX_BYTES  = 8 * 1024 * 1024; // 8 MB request body ≈ 6 MB raw audio

async function readBodyLimited(req, maxBytes) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        total += chunk.length;
        if (total > maxBytes) throw new Error('too large');
        chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { return {}; }
}

async function checkAuth(req) {
    const tok = extractToken(req);
    if (!tok) return false;
    try {
        if (!verifyToken(tok)) return false;
        if (await isRevoked(tok)) return false;
        return true;
    } catch { return false; }
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });

    // ── GET: serve audio ────────────────────────────────────────────────────
    if (req.method === 'GET') {
        const stored = await readMusicFile(id);
        if (!stored) return res.status(404).end();

        // stored is "data:audio/mpeg;base64,..." or raw base64
        const comma  = stored.indexOf(',');
        const rawB64 = comma >= 0 ? stored.slice(comma + 1) : stored;
        const buf    = Buffer.from(rawB64, 'base64');
        const total  = buf.length;

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Accept-Ranges', 'bytes');

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

    // ── Auth gate for write methods ─────────────────────────────────────────
    if (!(await checkAuth(req))) return res.status(401).json({ error: 'Unauthorized' });

    // ── POST: upload ────────────────────────────────────────────────────────
    if (req.method === 'POST') {
        let body;
        try { body = await readBodyLimited(req, FILE_MAX_BYTES); }
        catch { return res.status(413).json({ error: 'ファイルが大きすぎます（目安: 6MB 以下）' }); }

        const { dataUrl } = body;
        if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:audio/')) {
            return res.status(400).json({ error: 'dataUrl (audio) が必要です' });
        }

        await writeMusicFile(id, dataUrl);

        // Mark track as having a hosted file
        const items = await readJsonArray(MUSIC_FILE_PATH);
        const idx   = items.findIndex(x => x.id === id);
        if (idx >= 0) {
            items[idx] = { ...items[idx], audioFile: true, updatedAt: new Date().toISOString() };
            await writeJsonArray(MUSIC_FILE_PATH, items);
        }
        return res.status(200).json({ ok: true });
    }

    // ── DELETE: remove ──────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
        await deleteMusicFile(id);

        const items = await readJsonArray(MUSIC_FILE_PATH);
        const idx   = items.findIndex(x => x.id === id);
        if (idx >= 0) {
            items[idx] = { ...items[idx], audioFile: false, updatedAt: new Date().toISOString() };
            await writeJsonArray(MUSIC_FILE_PATH, items);
        }
        return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
}
