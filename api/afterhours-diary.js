/**
 * Vercel Serverless Function: /afterhours/diary
 *
 * Session gate for the diary admin page.
 *   Authenticated   → serve afterhours-diary.html
 *   Not authenticated → redirect to /afterhours (shows login)
 */

import { readFileSync } from 'fs';
import { join }         from 'path';
import { COOKIE_NAME, verifyToken, parseCookies } from './_auth.js';

export default function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    const cookies = parseCookies(req.headers.cookie);
    const authed  = verifyToken(cookies[COOKIE_NAME] || '');

    if (!authed) {
        res.setHeader('Location', '/afterhours');
        return res.status(302).end();
    }

    try {
        const html = readFileSync(join(process.cwd(), 'templates', 'afterhours-diary.html'), 'utf-8');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(html);
    } catch (err) {
        console.error('[afterhours-diary] readFile error:', err.message);
        return res.status(500).send('Internal server error');
    }
}
