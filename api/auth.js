/**
 * Vercel Serverless Function: /api/auth
 *
 * GET  ?action=check                  → verify current session → {ok: bool}
 * POST { action: "login",  password } → verify password, set session cookie
 * POST { action: "logout" }           → clear session cookie
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

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    const cookies = parseCookies(req.headers.cookie);

    /* ── GET ?action=check ────────────────────────────────────── */
    if (req.method === 'GET') {
        const ok = verifyToken(cookies[COOKIE_NAME] || '');
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
        res.setHeader('Set-Cookie', cookieHeader(makeToken()));
        return res.status(200).json({ ok: true });
    }

    /* ── POST logout ──────────────────────────────────────────── */
    if (action === 'logout') {
        res.setHeader('Set-Cookie', cookieHeader(null));
        return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
}
