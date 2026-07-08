/**
 * Vercel Serverless Function: /afterhours/*  (consolidated template handler)
 *
 * Serves all admin HTML templates from a single function to stay within
 * Vercel Hobby plan's 12-function limit.
 *
 * Route dispatch is done via the ?page= query parameter injected by the
 * vercel.json rewrites:
 *   /afterhours            → ?page=home
 *   /afterhours/diary      → ?page=diary
 *   /afterhours/live       → ?page=live
 *   /afterhours/login      → ?page=login
 *   /afterhours/analytics  → ?page=analytics
 *   /afterhours/milestones → ?page=milestones
 *   /afterhours/insights   → ?page=insights
 *   /afterhours/music      → ?page=music
 *
 * bump: 2026-07-08d — diary scheduled default fixed; diary-admin v4
 */

import { readFileSync } from 'fs';
import { join }         from 'path';

const TEMPLATES = {
    home:       'afterhours.html',
    diary:      'afterhours-diary.html',
    live:       'afterhours-live.html',
    music:      'afterhours-music.html',
    messages:   'afterhours-messages.html',
    login:      'login.html',
    analytics:  'afterhours-analytics.html',
    milestones: 'afterhours-milestones.html',
    insights:   'afterhours-insights.html',
};

export default function handler(req, res) {
    const qs   = new URL(req.url, 'http://localhost').searchParams;
    const page = qs.get('page') || 'home';
    const templateName = TEMPLATES[page];

    if (!templateName) {
        return res.status(404).send('Not found');
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    try {
        const html = readFileSync(
            join(process.cwd(), 'templates', templateName), 'utf-8');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(html);
    } catch (err) {
        console.error('[afterhours-pages] readFile error:', err.message, 'page:', page);
        return res.status(500).send('Internal server error');
    }
}
