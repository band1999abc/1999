/**
 * Music-only persistent storage.
 *
 * Music uses a dedicated key namespace in the shared Upstash Redis configured
 * by UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. It never falls back to
 * a writable filesystem.
 */

import { del, head, put } from '@vercel/blob';

const MUSIC_RECORDS_KEY = 'music:records:v1';
const MUSIC_JACKET_PREFIX = 'music:jacket:';
const MUSIC_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const MUSIC_BLOB_PATH_RE = /^music\/([a-zA-Z0-9_-]{1,128})\/(v[0-9]+-[a-z0-9-]+)\.mp3$/;
const MUSIC_RAW_VERSION = Symbol('musicRawVersion');

export class MusicStorageConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MusicStorageConfigError';
        this.statusCode = 503;
    }
}

export class MusicStorageConflictError extends Error {
    constructor() {
        super('Music metadata changed while this operation was in progress');
        this.name = 'MusicStorageConflictError';
        this.statusCode = 409;
    }
}

function requireMusicKv() {
    if (!process.env.UPSTASH_REDIS_REST_URL ||
        !process.env.UPSTASH_REDIS_REST_TOKEN) {
        throw new MusicStorageConfigError(
            'Music storage is not configured for this environment'
        );
    }
}

function requireMusicBlob() {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
        throw new MusicStorageConfigError(
            'Music Blob storage is not configured for this environment'
        );
    }
}

function assertMusicId(id) {
    const value = String(id || '');
    if (!MUSIC_ID_RE.test(value)) throw new Error('Invalid music id');
    return value;
}

function assertBlobPathForMusicId(pathname, musicId) {
    const id = assertMusicId(musicId);
    const value = String(pathname || '');
    const match = value.match(MUSIC_BLOB_PATH_RE);
    if (!match || match[1] !== id) throw new Error('Invalid music Blob pathname');
    return value;
}

async function musicKvPipeline(commands) {
    requireMusicKv();
    const base = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '');
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    const response = await fetch(`${base}/pipeline`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(commands),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Music Upstash error ${response.status}: ${text}`);
    }
    const result = await response.json();
    if (result.some(item => item && item.error)) {
        throw new Error('Music Upstash command failed');
    }
    return result;
}

export function isMusicStorageConfigError(error) {
    return error instanceof MusicStorageConfigError ||
        error?.name === 'MusicStorageConfigError';
}

export function musicStorageErrorResponse(res, error, logLabel = 'music-storage') {
    if (isMusicStorageConfigError(error)) {
        console.error(`[${logLabel}] configuration error`);
        return res.status(503).json({
            error: 'Music storage is not configured for this environment',
        });
    }
    if (error instanceof MusicStorageConflictError ||
        error?.name === 'MusicStorageConflictError') {
        console.warn(`[${logLabel}] concurrent Music update rejected`);
        return res.status(409).json({
            error: 'Music was updated by another request. Refresh and try again.',
        });
    }
    console.error(`[${logLabel}] error:`, error);
    return res.status(500).json({ error: 'Music storage operation failed' });
}

export async function readMusicRecords() {
    const result = await musicKvPipeline([['GET', MUSIC_RECORDS_KEY]]);
    const raw = result[0]?.result;
    if (raw === null || raw === undefined) {
        const empty = [];
        Object.defineProperty(empty, MUSIC_RAW_VERSION, {
            value: '[]', writable: true, enumerable: false,
        });
        return empty;
    }
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('Music records must be an array');
        Object.defineProperty(parsed, MUSIC_RAW_VERSION, {
            value: raw, writable: true, enumerable: false,
        });
        return parsed;
    } catch {
        throw new Error('Music records contain invalid JSON');
    }
}

export async function writeMusicRecords(records) {
    if (!Array.isArray(records)) throw new Error('Music records must be an array');
    const expected = records[MUSIC_RAW_VERSION];
    if (typeof expected !== 'string') {
        throw new Error('Music records must be read before they can be written');
    }
    const next = JSON.stringify(records);
    const compareAndSet = [
        "local current = redis.call('GET', KEYS[1])",
        "if not current then current = '[]' end",
        "if current ~= ARGV[1] then return 0 end",
        "redis.call('SET', KEYS[1], ARGV[2])",
        "return 1",
    ].join('\n');
    const result = await musicKvPipeline([[
        'EVAL', compareAndSet, 1, MUSIC_RECORDS_KEY, expected, next,
    ]]);
    if (Number(result[0]?.result) !== 1) throw new MusicStorageConflictError();
    records[MUSIC_RAW_VERSION] = next;
}

export async function readMusicRecord(id) {
    const records = await readMusicRecords();
    return records.find(record => record.id === id) || null;
}

export async function readMusicJacket(musicId) {
    const id = assertMusicId(musicId);
    const result = await musicKvPipeline([['GET', `${MUSIC_JACKET_PREFIX}${id}`]]);
    return result[0]?.result || null;
}

export async function writeMusicJacket(musicId, dataUrl) {
    const id = assertMusicId(musicId);
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        throw new Error('Invalid music jacket data');
    }
    await musicKvPipeline([['SET', `${MUSIC_JACKET_PREFIX}${id}`, dataUrl]]);
}

export async function deleteMusicJacket(musicId) {
    const id = assertMusicId(musicId);
    await musicKvPipeline([['DEL', `${MUSIC_JACKET_PREFIX}${id}`]]);
}

export async function putMusicBlob(pathname, body, contentType = 'audio/mpeg') {
    requireMusicBlob();
    if (!String(contentType).toLowerCase().startsWith('audio/mpeg')) {
        throw new Error('Music Blob must be audio/mpeg');
    }
    return put(pathname, body, {
        access: 'public',
        storeId: process.env.MUSIC_PUBLIC_BLOB_STORE_ID,
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'audio/mpeg',
    });
}

export async function inspectMusicBlob(url, expectedPathname, musicId) {
    requireMusicBlob();
    let diagnosticStage = 'inspect-blob';
    try {
        const pathname = assertBlobPathForMusicId(expectedPathname, musicId);
        diagnosticStage = 'inspect-head';
        let info;
        try {
            info = await head(url, {
                storeId: process.env.MUSIC_PUBLIC_BLOB_STORE_ID,
            });
        } catch (originalError) {
            let explicitTokenHead = 'failed';
            try {
                await head(url, {
                    token: process.env.MUSIC_PUBLIC_BLOB_READ_WRITE_TOKEN,
                });
                explicitTokenHead = 'success';
            } catch {
                // The original head error remains the operation's error.
            }
            if (originalError && typeof originalError === 'object') {
                Object.defineProperty(originalError, 'musicExplicitTokenHead', {
                    value: explicitTokenHead,
                    configurable: true,
                });
            }
            throw originalError;
        }
        diagnosticStage = 'inspect-pathname';
        if (info.pathname !== pathname) throw new Error('Music Blob pathname mismatch');
        diagnosticStage = 'inspect-content-type';
        if (info.contentType !== 'audio/mpeg') throw new Error('Music Blob content type mismatch');
        return info;
    } catch (error) {
        if (error && typeof error === 'object') {
            error.musicDiagnosticStage = diagnosticStage;
        }
        throw error;
    }
}

export async function deleteMusicBlob(url) {
    requireMusicBlob();
    if (!url) return;
    await del(url, {
        storeId: process.env.MUSIC_PUBLIC_BLOB_STORE_ID,
    });
}

export function makeMusicBlobPath(musicId, version = Date.now()) {
    const id = assertMusicId(musicId);
    const suffix = `${String(version).replace(/[^0-9]/g, '')}-${Math.random().toString(36).slice(2, 10)}`;
    return `music/${id}/v${suffix}.mp3`;
}

export function validateMusicBlobPath(pathname, musicId) {
    return assertBlobPathForMusicId(pathname, musicId);
}

export function musicRecordsKey() {
    return MUSIC_RECORDS_KEY;
}