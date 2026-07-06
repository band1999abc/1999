/**
 * Vercel Serverless Function: /api/auth
 *
 * GET  (no body)                      → verify current session → {ok: bool}
 * POST { action: "login",  password } → verify password → {ok: true, token}
 * POST { action: "logout" }           → clear session cookie → {ok: true}
 *
 * Auth is checked via:
 *   1. Authorization: Bearer <token>  header  (sessionStorage path)
 *   2. Cookie admin_session=<token>            (direct-tab fallback)
 */

import { timingSafeEqual } from 'crypto';
import {
    COOKIE_NAME, makeToken, verifyToken, parseCookies, cookieHeader
} from './_auth.js';

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { return {}; }
}

/**
 * Returns list of {name, password, comment} members.
 * Reads MEMBERS env var (JSON array) or falls back to ADMIN_PASSWORD.
 */
function getMembers() {
    const raw = (process.env.MEMBERS || '').trim();
    if (raw) {
        try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length) return arr;
        } catch {}
    }
    const pw = process.env.ADMIN_PASSWORD || '';
    return pw ? [{ name: 'Admin', password: pw, comment: 'おかえりなさい。' }] : [];
}

function getMemberComment(name) {
    const m = getMembers().find(m => m.name === name);
    return m ? (m.comment || '') : '';
}

/** Returns member name (str) if authenticated, null otherwise. */
function getAuthedMember(req) {
    // 1. Bearer token (sessionStorage path — works in iframes)
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
        const result = verifyToken(auth.slice(7));
        if (result !== null) return result;
    }
    // 2. Cookie fallback
    const cookies = parseCookies(req.headers.cookie);
    const result = verifyToken(cookies[COOKIE_NAME] || '');
    if (result !== null) return result;
    return null;
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    /* ── GET — session check ──────────────────────────────────── */
    if (req.method === 'GET') {
        const member = getAuthedMember(req);
        if (member === null) return res.status(401).json({ ok: false });
        const comment = getMemberComment(member);
        return res.status(200).json({ ok: true, member, comment });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const body   = await readBody(req);
    const action = body.action;

    /* ── POST login ───────────────────────────────────────────── */
    if (action === 'login') {
        const given   = String(body.password ?? '');
        const members = getMembers();
        let matched   = null;
        for (const m of members) {
            const pw = String(m.password ?? '');
            const a  = Buffer.from(given);
            const b  = Buffer.from(pw || '\x00');
            // Always call timingSafeEqual; only count as match if pw non-empty
            // and lengths are equal (required by timingSafeEqual).
            const sameLen = pw.length > 0 && a.length === b.length;
            const isMatch = sameLen && timingSafeEqual(a, b);
            if (isMatch && matched === null) matched = m;
            // No break — always iterate all members to avoid timing leaks
        }
        if (!matched) return res.status(401).json({ ok: false });
        const token = makeToken(matched.name || '');
        res.setHeader('Set-Cookie', cookieHeader(token));
        return res.status(200).json({ ok: true, token, member: matched.name || '' });
    }

    /* ── POST logout ──────────────────────────────────────────── */
    if (action === 'logout') {
        res.setHeader('Set-Cookie', cookieHeader(null));
        return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
}
