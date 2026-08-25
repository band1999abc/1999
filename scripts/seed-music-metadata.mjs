/**
 * One-time, fail-closed Music metadata initialization.
 *
 * This is intentionally never invoked by application code. Run it only after
 * initializing the dedicated Music key in the shared Upstash database, first
 * against Preview and then as an explicitly approved Production migration.
 * It refuses to overwrite a non-matching Music store and preserves the
 * production Music ID verbatim.
 */

import { readFile } from 'node:fs/promises';

const KEY = 'music:records:v1';
const PRODUCTION_MUSIC_ID = 'e392ad86-98c9-4a31-90d6-a3e9a140802c';
const WORKSPACE_ONLY_ID = '828ba0f2-30a7-4446-a038-c2815566caf7';

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) {
    throw new Error(
        'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required.'
    );
}

const source = JSON.parse(await readFile(new URL('../data/music.json', import.meta.url), 'utf8'));
if (!Array.isArray(source) || !source.some(track => track.id === PRODUCTION_MUSIC_ID)) {
    throw new Error(`Source metadata does not contain the required production ID ${PRODUCTION_MUSIC_ID}`);
}
if (source.some(track => track.id === WORKSPACE_ONLY_ID)) {
    throw new Error('Refusing to seed a workspace-only Music ID into the dedicated Music store');
}

const endpoint = `${url.replace(/\/$/, '')}/pipeline`;
async function command(commands) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(commands),
    });
    if (!response.ok) throw new Error(`Music Upstash request failed (${response.status})`);
    return response.json();
}

const current = await command([['GET', KEY]]);
const raw = current[0]?.result;
const next = JSON.stringify(source);

if (raw !== null && raw !== undefined && raw !== next) {
    throw new Error(
        'Dedicated Music metadata already exists and differs from the approved source. Refusing to overwrite it.'
    );
}

if (raw === next) {
    console.log('Music metadata already matches the approved source; no write performed.');
} else {
    await command([['SET', KEY, next]]);
    console.log(`Initialized dedicated Music metadata with ${source.length} record(s), including ${PRODUCTION_MUSIC_ID}.`);
}