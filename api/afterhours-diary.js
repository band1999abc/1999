/**
 * Vercel Serverless Function: /afterhours/diary
 *
 * Always serves afterhours-diary.html. Auth gate is handled client-side
 * by admin.js (Bearer token via sessionStorage).
 */

import { readFileSync } from 'fs';
import { join }         from 'path';

export default function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    try {
        const html = readFileSync(join(process.cwd(), 'templates', 'afterhours-diary.html'), 'utf-8');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(html);
    } catch (err) {
        console.error('[afterhours-diary] readFile error:', err.message);
        return res.status(500).send('Internal server error');
    }
}
