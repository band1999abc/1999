/**
 * Shared authentication utilities for Vercel serverless functions.
 * Prefixed with _ so Vercel does not expose this as a route.
 *
 * Token format: base64url(payload) + "." + hmac-sha256-hex(secret, payload)
 * Payload:      JSON { exp: unixMs }
 * Cookie:       admin_session=<token>; HttpOnly; SameSite=Strict; Path=/
 */

import { createHmac, timingSafeEqual, createHash } from 'crypto';

export const COOKIE_NAME = 'admin_session';
export const MAX_AGE     = 8 * 60 * 60; // 8 hours in seconds

export function makeToken(memberName = '') {
    const exp     = Date.now() + MAX_AGE * 1000;
    const payload = Buffer.from(JSON.stringify({ exp, member: memberName })).toString('base64url');
    const secret  = process.env.SESSION_SECRET || '';
    const sig     = createHmac('sha256', secret).update(payload).digest('hex');
    return `${payload}.${sig}`;
}

/** Returns member name (string, possibly '') if valid, null if invalid/expired. */
export function verifyToken(token) {
    try {
        const dot = token.lastIndexOf('.');
        if (dot < 1) return null;
        const payload  = token.slice(0, dot);
        const sig      = token.slice(dot + 1);
        // Reject alternate/truncated hex encodings that would hash differently
        // in the denylist while decoding to the same signature bytes.
        if (!/^[a-f0-9]{64}$/.test(sig)) return null;
        const secret   = process.env.SESSION_SECRET || '';
        const expected = createHmac('sha256', secret).update(payload).digest('hex');
        const a = Buffer.from(sig,      'hex');
        const b = Buffer.from(expected, 'hex');
        if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (!data || typeof data !== 'object' || Array.isArray(data) ||
            typeof data.exp !== 'number' || !Number.isFinite(data.exp) ||
            !Number.isSafeInteger(data.exp) || Number.isNaN(new Date(data.exp).getTime()) ||
            Date.now() >= data.exp) return null;
        return data.member ?? '';
    } catch {
        return null;
    }
}

export function parseCookies(header) {
    if (!header) return {};
    const out = {};
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx < 0) continue;
        out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
    return out;
}

export function cookieHeader(token) {
    const age = token ? MAX_AGE : 0;
    const val = token || '';
    return `${COOKIE_NAME}=${val}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}`;
}

// ── Token helpers ─────────────────────────────────────────────────────────────

/** Bearer takes precedence even if invalid; Cookie is used only without Bearer. */
export function extractToken(req) {
    const auth = req.headers['authorization'] || '';
    // Recognize malformed Unicode whitespace as a presented Bearer, but only
    // strip legal HTTP whitespace: malformed credentials must fail, not fall back.
    if (/^Bearer(?:\s|$)/i.test(auth)) return auth.replace(/^Bearer[ \t]*/i, '');
    const cookies = parseCookies(req.headers.cookie || '');
    return cookies[COOKIE_NAME] || '';
}

// ── Token denylist (Upstash KV) ───────────────────────────────────────────────

function _hash(token) {
    return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

/** Low-level single-command Upstash REST call.  Returns the `result` field. */
async function _kvRest(path) {
    const base = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
    const tok  = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!base || !tok) throw new Error('Session storage is not configured');
    const res = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${tok}` },
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}: ${await res.text()}`);
    const body = await res.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.hasOwn(body, 'error') || !Object.hasOwn(body, 'result')) {
        throw new Error('Invalid session storage response');
    }
    return body.result;
}

/**
 * Add a token to the revocation list in KV.
 * TTL = MAX_AGE + 60s (deliberately over-generous; the KV key only needs to
 * outlive the token's exp).  Using a fixed TTL avoids parsing the payload.
 * Call on logout so the token is immediately unusable.
 */
export async function denylistToken(token) {
    if (!token) return;
    const hash = _hash(token);
    const result = await _kvRest(`/set/revoked:${hash}/1/EX/${MAX_AGE + 60}`);
    if (result !== 'OK') throw new Error('Session revocation was not acknowledged');
}

/**
 * true: revoked; false: confirmed not revoked; null: verification unavailable.
 * Callers must authorize only when the result is strictly false.
 */
export async function isRevoked(token) {
    if (!token) return false;
    try {
        const hash   = _hash(token);
        const result = await _kvRest(`/get/revoked:${hash}`);
        if (result === null) return false;
        if (result === '1') return true;
        return null;
    } catch {
        return null;
    }
}
