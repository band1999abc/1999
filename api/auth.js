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

function isAuthed(req) {
    // 1. Bearer token (sessionStorage path — works in iframes)
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
        if (verifyToken(auth.slice(7))) return true;
    }
    // 2. Cookie fallback
    const cookies = parseCookies(req.headers.cookie);
    return verifyToken(cookies[COOKIE_NAME] || '');
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    /* ── GET — session check ──────────────────────────────────── */
    if (req.method === 'GET') {
        const ok = isAuthed(req);
        return res.status(ok ? 200 : 401).json({ ok });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const body   = await readBody(req);
    const action = body.action;

    /* ── POST login ───────────────────────────────────────────── */
    if (action === 'login') {
        const adminPw = process.env.ADMIN_PASSWORD || '';
        const given   = String(body.password ?? '');

        const a = Buffer.from(given);
        const b = Buffer.from(adminPw);
        const ok = adminPw.length > 0 &&
                   a.length === b.length &&
                   timingSafeEqual(a, b);

        if (!ok) {
            return res.status(401).json({ ok: false });
        }
        const token = makeToken();
        // Return token in body so client stores it in sessionStorage
        // (cookie also set as fallback for direct-tab access)
        res.setHeader('Set-Cookie', cookieHeader(token));
        return res.status(200).json({ ok: true, token });
    }

    /* ── POST logout ──────────────────────────────────────────── */
    if (action === 'logout') {
        res.setHeader('Set-Cookie', cookieHeader(null));
        return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
}
