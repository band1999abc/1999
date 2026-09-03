/**
 * Authenticated Vercel Blob client-upload token endpoint for After Hours.
 *
 * The Blob read/write token remains server-side. Browser clients receive only a
 * short-lived, pathname-restricted upload token after the existing admin
 * session has been verified.
 */

import { handleUpload } from '@vercel/blob/client';
import { verifyToken, extractToken, isRevoked } from './_auth.js';
import { readMusicRecord, validateMusicBlobPath, musicStorageErrorResponse } from './_music_storage.js';

const MAX_MUSIC_FILE_BYTES = 64 * 1024 * 1024;

async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 64 * 1024) throw new Error('Request body too large');
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        throw new Error('Invalid JSON request');
    }
}

function parsePayload(value) {
    try {
        const parsed = JSON.parse(value || '{}');
        if (!parsed || typeof parsed.musicId !== 'string') throw new Error();
        return parsed;
    } catch {
        throw new Error('Invalid upload payload');
    }
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let body;
    try {
        body = await readJson(req);
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    const token = extractToken(req);
    const authed = verifyToken(token) !== null && !(await isRevoked(token));
    const isBlobCallback = body?.type === 'blob.upload-completed';
    if (!authed && !isBlobCallback) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const result = await handleUpload({
            token: process.env.MUSIC_PUBLIC_BLOB_READ_WRITE_TOKEN,
            request: req,
            body,
            onBeforeGenerateToken: async (pathname, clientPayload) => {
                if (!authed) throw new Error('Unauthorized');

                const payload = parsePayload(clientPayload);
                validateMusicBlobPath(pathname, payload.musicId);
                const track = await readMusicRecord(payload.musicId);
                if (!track) throw new Error('Track not found');

                return {
                    allowedContentTypes: ['audio/mpeg'],
                    maximumSizeInBytes: MAX_MUSIC_FILE_BYTES,
                    addRandomSuffix: false,
                    allowOverwrite: false,
                    tokenPayload: JSON.stringify({
                        musicId: payload.musicId,
                        pathname,
                    }),
                };
            },
            onUploadCompleted: async () => {
                // Attachment to the Music record is intentionally performed by
                // the authenticated admin client after it receives the Blob URL.
                // The signed callback only confirms that upload transport ended.
            },
        });
        return res.status(200).json(result);
    } catch (e) {
        if (e?.message === 'Track not found') {
            return res.status(404).json({ error: 'Track not found' });
        }
        if (e?.message === 'Unauthorized') {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        return musicStorageErrorResponse(res, e, 'music-upload');
    }
}