/**
 * Members main photo storage.
 *
 * Production uses the same Upstash REST connection as Music jacket images.
 */

const MEMBERS_MAIN_PHOTO_KEY = 'members:main-photo:v1';

export class MembersStorageConfigError extends Error {
    constructor() {
        super('Members storage is not configured for this environment');
        this.name = 'MembersStorageConfigError';
        this.statusCode = 503;
    }
}

function requireMembersKv() {
    if (!process.env.UPSTASH_REDIS_REST_URL ||
        !process.env.UPSTASH_REDIS_REST_TOKEN) {
        throw new MembersStorageConfigError();
    }
}

async function membersKv(command) {
    requireMembersKv();
    const base = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '');
    const response = await fetch(`${base}/pipeline`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify([command]),
    });
    if (!response.ok) throw new Error(`Members Upstash error ${response.status}`);
    const body = await response.json();
    if (body[0]?.error) throw new Error('Members Upstash command failed');
    return body[0]?.result;
}

export async function readMembersMainPhoto() {
    return await membersKv(['GET', MEMBERS_MAIN_PHOTO_KEY]) || null;
}

export async function writeMembersMainPhoto(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/') ||
        !dataUrl.includes(';base64,')) {
        throw new Error('Invalid Members photo data');
    }
    await membersKv(['SET', MEMBERS_MAIN_PHOTO_KEY, dataUrl]);
}

export async function deleteMembersMainPhoto() {
    await membersKv(['DEL', MEMBERS_MAIN_PHOTO_KEY]);
}

export function membersStorageErrorResponse(res, error, label = 'members-storage') {
    if (error instanceof MembersStorageConfigError ||
        error?.name === 'MembersStorageConfigError') {
        console.error(`[${label}] configuration error`);
        return res.status(503).json({ error: 'Members storage is not configured' });
    }
    console.error(`[${label}] error:`, error);
    return res.status(500).json({ error: 'Members storage operation failed' });
}