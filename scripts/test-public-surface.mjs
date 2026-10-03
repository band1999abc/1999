import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import middleware from '../middleware.ts';

const root = new URL('../', import.meta.url);
const publicAssets = JSON.parse(readFileSync(new URL('public-assets.json', root), 'utf8'));
const responseFor = (path, method = 'GET') =>
    middleware(new Request('https://site.invalid' + path, { method }));

test('internal files and encoded paths are denied for GET and HEAD', () => {
    const privatePaths = [
        '/server.py', '/data', '/data/music.json', '/data/diary.json',
        '/.agents', '/.agents/memory/MEMORY.md', '/.git/HEAD',
        '/scripts', '/scripts/test_api_output.txt', '/scripts/test-public-surface.mjs',
        '/attached_assets', '/attached_assets/past-request.txt',
        '/artifacts/mockup-sandbox/package.json', '/templates/login.html',
        '/package.json', '/package-lock.json', '/vercel.json',
        '/public-assets.json', '/middleware.ts', '/music-upload-client.js',
        '/%64ata/music.json', '/data%2Fmusic.json',
        '/%2eagents/memory/MEMORY.md', '/%2564ata/music.json',
        '/api/%2e%2e/server.py', '/api%2F..%2Fdata/music.json',
    ];
    for (const path of privatePaths) {
        for (const method of ['GET', 'HEAD']) {
            assert.equal(responseFor(path, method)?.status, 404, `${method} ${path}`);
        }
    }
});

test('every public static file exists and remains accessible with cache queries', () => {
    assert.equal(responseFor('/'), undefined);
    for (const file of publicAssets.staticFiles) {
        assert.ok(existsSync(new URL(file, root)), `Missing public asset: ${file}`);
        assert.equal(responseFor('/' + file + '?v=1'), undefined, file);
    }
    for (const path of publicAssets.pageRoutes) {
        assert.equal(responseFor(path), undefined, path);
    }
});

test('existing API routes pass through without replacing authentication or filtering', () => {
    for (const path of [
        '/api/music', '/api/music/example-id', '/api/music-file/example-id',
        '/api/music-jacket/example-id', '/api/member-photo/main',
        '/api/live', '/api/diary', '/api/messages', '/api/weather',
        '/api/auth', '/api/analytics', '/api/afterhours-pages?page=login',
    ]) {
        assert.equal(responseFor(path), undefined, path);
    }
});

test('public and admin HTML references are covered by the public asset list', () => {
    const htmlFiles = [
        ...publicAssets.staticFiles.filter(file => file.endsWith('.html')),
        ...[
            'login', 'afterhours', 'afterhours-diary', 'afterhours-live',
            'afterhours-music', 'afterhours-members', 'afterhours-messages',
            'afterhours-weather-phrases', 'afterhours-analytics',
            'afterhours-milestones', 'afterhours-insights',
        ].map(name => `templates/${name}.html`),
    ];
    for (const file of htmlFiles) {
        const html = readFileSync(new URL(file, root), 'utf8');
        for (const [, reference] of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
            if (/^(https?:|mailto:|#)/.test(reference)) continue;
            const filename = reference.split(/[?#]/)[0].replace(/^\//, '');
            if (/\.(?:css|js|png|html|json)$/i.test(filename)) {
                assert.ok(publicAssets.staticFiles.includes(filename),
                    `${file} references unlisted asset ${filename}`);
            }
        }
    }
});