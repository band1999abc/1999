/**
 * Vercel Serverless Function: /afterhours
 *
 * Always serves afterhours.html. The client-side JS (admin.js) performs
 * the auth gate by calling GET /api/auth with the Bearer token, and
 * redirects to /afterhours/login if not authenticated.
 *
 * This avoids third-party cookie blocking when the page is viewed inside
 * an iframe (e.g. Replit preview or embedded players).
 */

import { readFileSync } from 'fs';
import { join }         from 'path';

export default function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    try {
        const html = readFileSync(join(process.cwd(), 'templates', 'afterhours.html'), 'utf-8');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(html);
    } catch (err) {
        console.error('[afterhours] readFile error:', err.message);
        return res.status(500).send('Internal server error');
    }
}
