/**
 * Shared authentication utilities for Vercel serverless functions.
 * Prefixed with _ so Vercel does not expose this as a route.
 *
 * Token format: base64url(payload) + "." + hmac-sha256-hex(secret, payload)
 * Payload:      JSON { exp: unixMs }
 * Cookie:       admin_session=<token>; HttpOnly; SameSite=Strict; Path=/
 */

import { createHmac, timingSafeEqual } from 'crypto';

export const COOKIE_NAME = 'admin_session';
export const MAX_AGE     = 7 * 24 * 60 * 60; // 7 days in seconds

export function makeToken() {
    const exp     = Date.now() + MAX_AGE * 1000;
    const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
    const secret  = process.env.SESSION_SECRET || '';
    const sig     = createHmac('sha256', secret).update(payload).digest('hex');
    return `${payload}.${sig}`;
}

export function verifyToken(token) {
    try {
        const dot = token.lastIndexOf('.');
        if (dot < 1) return false;
        const payload  = token.slice(0, dot);
        const sig      = token.slice(dot + 1);
        const secret   = process.env.SESSION_SECRET || '';
        const expected = createHmac('sha256', secret).update(payload).digest('hex');
        const a = Buffer.from(sig,      'hex');
        const b = Buffer.from(expected, 'hex');
        if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        return Date.now() < data.exp;
    } catch {
        return false;
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
