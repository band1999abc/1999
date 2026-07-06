/**
 * Vercel Serverless Function: /afterhours
 *
 * Server-side session gate before delivering any admin UI.
 *   Authenticated   → serve afterhours.html (admin dashboard)
 *   Not authenticated → serve login.html    (login form)
 *
 * Both pages live in /templates/ which is not directly routed.
 */

import { readFileSync } from 'fs';
import { join }         from 'path';
import { COOKIE_NAME, verifyToken, parseCookies } from './_auth.js';

export default function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    const cookies  = parseCookies(req.headers.cookie);
    const authed   = verifyToken(cookies[COOKIE_NAME] || '');
    const filename = authed ? 'afterhours.html' : 'login.html';

    try {
        const html = readFileSync(join(process.cwd(), 'templates', filename), 'utf-8');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(html);
    } catch (err) {
        console.error('[afterhours] readFile error:', err.message);
        return res.status(500).send('Internal server error');
    }
}
