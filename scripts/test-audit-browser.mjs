// Run: node scripts/test-audit-browser.mjs
// Optional PLAYWRIGHT_MODULE and CHROMIUM_PATH select an existing browser.
// All API data/media are fixtures; no real login, write, or Production request.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import middleware from '../middleware.ts';

const root = new URL('../', import.meta.url);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#353b50"/></svg>';
const tracks = [1, 2].map(i => ({
    id: 'fixture-' + i, title: '監査テスト曲' + i, status: 'published',
    releaseDate: '2026-01-01', audioFile: true, lyrics: '歌詞テスト\n二行目', jacket: false,
}));
const posts = [{ id: 'post', date: '2026-01-01', title: 'Diary test', body: '本文テスト', status: 'published' }];
const lives = [{ id: 'live', date: '2099-01-01', venue: 'Live test', status: 'published', flyer: true }];
const wave = Buffer.alloc(44 + 8000 * 2 * 10);
wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(8000, 24); wave.writeUInt32LE(16000, 28);
wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36);
wave.writeUInt32LE(wave.length - 44, 40);
const mime = { html: 'text/html', css: 'text/css', js: 'application/javascript', png: 'image/png', json: 'application/json' };
const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture.invalid');
    const denied = middleware(new Request(url, { method: req.method }));
    if (denied) { res.writeHead(denied.status); res.end('Not found'); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    const path = url.pathname;
    if (path.startsWith('/api/music-file/')) {
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Accept-Ranges', 'bytes');
        const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
        if (range) {
            const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), wave.length - 1) : wave.length - 1;
            res.writeHead(206, { 'Content-Range': 'bytes ' + start + '-' + end + '/' + wave.length, 'Content-Length': end - start + 1 });
            res.end(wave.subarray(start, end + 1));
        } else res.end(wave);
        return;
    }
    if (path.startsWith('/api/flyer/')) { res.setHeader('Content-Type', 'image/svg+xml'); res.end(svg); return; }
    if (path.startsWith('/api/')) {
        const value = path === '/api/music' ? tracks
            : path.startsWith('/api/music/') ? tracks.find(t => t.id === path.split('/').pop())
            : path === '/api/diary' ? posts
            : path === '/api/live' ? lives
            : path === '/api/auth' ? { ok: false }
            : path === '/api/member-photo/main' ? { hasPhoto: false }
            : path === '/api/weather' ? { weather: 'Clear', temp: 20, city: 'Fixture' }
            : [];
        res.writeHead(path === '/api/auth' ? (process.argv.includes('--auth-error') ? 503 : 401) : 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(value ?? {})); return;
    }
    const admin = path.match(/^\/afterhours(?:\/([a-z-]+))?$/);
    const file = admin ? 'templates/' + (admin[1] === 'login' ? 'login' : 'afterhours' + (admin[1] ? '-' + admin[1] : '')) + '.html'
        : path === '/' ? 'index.html' : path.slice(1);
    try {
        res.setHeader('Content-Type', mime[file.split('.').pop()] || 'application/octet-stream');
        res.end(readFileSync(new URL(file, root)));
    } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(process.argv.includes('--serve') ? 8099 : 0, '0.0.0.0', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
if (process.argv.includes('--serve')) {
    console.log('Fixture preview listening on port 8099');
} else {
    const require = createRequire(import.meta.url);
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    const browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || undefined,
        headless: true, args: ['--no-sandbox'],
    });
    const context = await browser.newContext({ viewport: { width: 375, height: 900 }, serviceWorkers: 'block' });
    const errors = [];
    await context.route('**/*', route => {
        const req = route.request();
        if (!['GET', 'HEAD'].includes(req.method()) || new URL(req.url()).pathname === '/analytics.js') return route.abort();
        if (!req.url().startsWith(base) && !req.url().startsWith('https://fonts.')) return route.abort();
        return route.continue();
    });
    await context.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
            const style = document.createElement('style');
            style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;}';
            document.head.appendChild(style);
        });
        const create = document.createElement;
        window.__audios = [];
        document.createElement = function (tag, ...args) {
            const element = create.call(this, tag, ...args);
            if (tag === 'audio') window.__audios.push(element);
            return element;
        };
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    const open = path => page.goto(base + path, { waitUntil: 'networkidle' });
    const playButton = async () => {
        await page.locator('.cp-btn').focus();
        await page.keyboard.press('Enter');
    };
    try {
        for (const [path, api, selector, emptyText] of [
            ['/music.html', '/api/music', '#song-list', 'Now Brewing...'],
            ['/diary.html', '/api/diary', '#diary-list', 'まだ投稿がありません。'],
        ]) {
            for (const fault of ['http', 'network', 'json', 'object', 'bad-item', 'empty', 'loading']) {
                let restore = false, release;
                await context.route(base + api, async route => {
                    if (restore) return route.continue();
                    if (fault === 'network') return route.abort();
                    if (fault === 'loading') {
                        await new Promise(resolve => { release = resolve; });
                        return route.fulfill({ json: [] });
                    }
                    return route.fulfill({
                        status: fault === 'http' ? 500 : 200,
                        contentType: 'application/json',
                        body: fault === 'json' ? '{' : JSON.stringify(fault === 'empty' ? [] : fault === 'bad-item' ? [null] : { error: 'fixture' }),
                    });
                });
                if (fault === 'loading') {
                    await page.goto(base + path, { waitUntil: 'domcontentloaded' });
                    await page.waitForFunction(s => document.querySelector(s).dataset.state === 'loading', selector);
                    assert.ok((await page.locator(selector).innerText()).includes('読み込み中'));
                    release();
                    await page.waitForFunction(s => document.querySelector(s).dataset.state === 'empty', selector);
                } else {
                    await open(path);
                    assert.equal(await page.locator(selector).getAttribute('data-state'), fault === 'empty' ? 'empty' : 'error');
                    const text = await page.locator(selector).innerText();
                    if (fault === 'empty') assert.ok(text.includes(emptyText));
                    else {
                        assert.ok(!text.includes(emptyText));
                        restore = true;
                        await page.locator(selector + ' button').click({ force: true });
                        await page.waitForFunction(s => document.querySelector(s).dataset.state === 'success', selector);
                    }
                }
                await context.unroute(base + api);
            }
        }
        console.log('PASS Music/Diary loading, populated, empty, HTTP/network/JSON/shape errors and retry');
        let audioFault = true, audioRequests = 0;
        await context.route(base + '/api/music-file/**', route => {
            audioRequests++;
            return audioFault ? route.fulfill({ status: 404, body: 'Simulated missing media' }) : route.continue();
        });
        await open('/track.html?id=fixture-1');
        await playButton();
        await page.waitForFunction(() => window.__audios[0].error);
        const failedRequests = audioRequests;
        audioFault = false;
        await playButton();
        await page.waitForFunction(() => window.__audios[0].currentTime > 0.1, {}, { timeout: 5000 })
            .catch(async error => {
                console.error('Media recovery diagnostics', await page.evaluate(() => ({
                    time: window.__audios[0].currentTime, error: window.__audios[0].error?.code,
                    paused: window.__audios[0].paused, ready: window.__audios[0].readyState,
                    text: document.querySelector('.cp-times').textContent,
                })), { audioRequests, failedRequests });
                throw error;
            });
        assert.ok(audioRequests > failedRequests);
        await playButton();
        assert.ok(await page.evaluate(() => window.__audios[0].paused));
        const box = await page.locator('.cp-bar-outer').boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        assert.ok(await page.evaluate(() => window.__audios[0].currentTime > 3));
        await page.locator('.cp-bar-outer').focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#track-lyrics').innerText(), tracks[0].lyrics);
        await context.unroute(base + '/api/music-file/**');
        await open('/track.html?id=fixture-2');
        await playButton();
        await page.waitForFunction(() => window.__audios[0].currentTime > 0.1);
        await playButton();
        assert.equal(await page.locator('#track-lyrics').innerText(), tracks[1].lyrics);
        console.log('PASS 2 tracks, media failure/recovery, play/pause, pointer/keyboard seek and Lyrics');
        await open('/live.html');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.className), 'live-flyer-indicator');
        for (const key of ['Enter', 'Space']) {
            await page.keyboard.press(key);
            await page.waitForSelector('.live-flyer-modal.is-open');
            await page.waitForFunction(() => document.querySelector('.live-flyer-modal-img').naturalWidth > 0);
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('.live-flyer-modal.is-open').count(), 0);
            assert.equal(await page.evaluate(() => document.activeElement.className), 'live-flyer-indicator');
        }
        await page.locator('.has-flyer').click({ force: true });
        await page.waitForSelector('.live-flyer-modal.is-open');
        await page.keyboard.press('Escape');
        console.log('PASS flyer Tab/Enter/Space, pointer, Escape and focus return');
        for (const authMode of [401, 500, 503, 'network', 'json', 200]) {
            await context.route(base + '/api/auth', route => authMode === 'network' ? route.abort()
                : route.fulfill({ status: typeof authMode === 'number' ? authMode : 200, contentType: 'application/json',
                    body: authMode === 'json' ? '{' : JSON.stringify({ ok: authMode === 200, member: 'Fixture' }) }));
            await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
            await page.evaluate(() => sessionStorage.setItem('admin_token', 'fixture-token'));
            await open('/afterhours/music');
            if (authMode === 401) {
                assert.ok(page.url().endsWith('/afterhours/login'));
                assert.equal(await page.evaluate(() => sessionStorage.getItem('admin_token')), null);
            } else if (authMode === 200) {
                assert.ok(await page.locator('body').evaluate(e => !e.classList.contains('auth-hidden')));
            } else {
                assert.ok(page.url().endsWith('/afterhours/music'));
                assert.ok((await page.locator('#auth-status').innerText()).includes('認証状態を確認できませんでした'));
                assert.equal(await page.evaluate(() => sessionStorage.getItem('admin_token')), 'fixture-token');
                assert.ok(await page.locator('body').evaluate(e => e.classList.contains('auth-hidden')));
                await context.unroute(base + '/api/auth');
                await context.route(base + '/api/auth', route => route.fulfill({ json: { ok: true } }));
                await page.locator('#auth-status button').click();
                await page.waitForFunction(() => !document.body.classList.contains('auth-hidden'));
            }
            await context.unroute(base + '/api/auth');
        }
        console.log('PASS auth 401 redirect, 500/503/network/JSON stay hidden, preserved token and retry recovery');
        for (const width of [320, 360, 375, 390, 430, 768, 1024, 1280, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            for (const path of ['/', '/music.html', '/live.html', '/diary.html', '/members.html', '/contact.html', '/track.html?id=fixture-1', '/track.html?id=fixture-2', '/hibiware.html']) {
                await open(path + (path.includes('?') ? '&' : '?') + 'night=1');
                await page.evaluate(() => document.fonts.ready);
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), width + ' ' + path);
                if (path === '/members.html') {
                    const fits = await page.evaluate(() => {
                        const h = document.querySelector('h1'), range = document.createRange();
                        range.selectNodeContents(h);
                        const text = range.getBoundingClientRect(), card = document.querySelector('.card').getBoundingClientRect();
                        return text.left >= card.left && text.right <= card.right;
                    });
                    assert.ok(fits, 'Members heading at ' + width);
                }
                if (path === '/music.html') assert.equal(await page.locator('.song-link').count(), 2);
            }
        }
        for (const href of ['music.html', 'live.html', 'diary.html', 'members.html', 'contact.html']) {
            await open('/');
            await page.locator('nav a[href="' + href + '"]').click({ force: true });
            await page.waitForURL('**/' + href);
            await page.locator('a[href="/"]').click({ force: true });
            await page.waitForURL(base + '/');
        }
        console.log('PASS all 9 viewport widths, 9 public screens, Members bounds, Home navigation and 2 songs');
        await open('/music.html?night=1');
        const contrast = await page.evaluate(() => {
            const rgb = s => s.match(/[\d.]+/g).slice(0, 3).map(Number);
            const lum = values => values.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; })
                .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
            const bg = lum(rgb(getComputedStyle(document.querySelector('.card')).backgroundColor));
            return ['.song-year', 'footer'].map(s => {
                const fg = lum(rgb(getComputedStyle(document.querySelector(s)).color));
                return (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05);
            });
        });
        assert.ok(contrast.every(v => v >= 4.5));
        console.log('PASS night text contrast ' + contrast.map(v => v.toFixed(2)).join(', '));
        const swContext = await browser.newContext({ serviceWorkers: 'allow' });
        const swPage = await swContext.newPage();
        await swPage.goto(base + '/api/auth');
        await swPage.evaluate(async () => {
            const old = await caches.open('1999-v32');
            await old.put('/style.css?v=40', new Response('STALE-CSS'));
            await old.put('/server.py', new Response('STALE-INTERNAL'));
        });
        await swPage.goto(base + '/music.html', { waitUntil: 'networkidle' });
        await swPage.waitForFunction(() => navigator.serviceWorker.controller);
        const cacheState = await swPage.evaluate(async () => ({
            keys: await caches.keys(),
            internal: !!(await caches.match('/server.py')),
            css: await (await caches.match('/style.css?v=40')).text(),
        }));
        assert.deepEqual(cacheState.keys, ['1999-v35']);
        assert.equal(cacheState.internal, false);
        assert.ok(cacheState.css.includes('--text-muted: #8a94a9'));
        await swPage.reload({ waitUntil: 'networkidle' });
        assert.equal(await swPage.locator('.song-link').count(), 2);
        await swContext.close();
        console.log('PASS v32 removed, v35 active, new CSS loaded, internal cached response removed and reload');
        assert.deepEqual(errors, []);
        console.log('PASS no uncaught browser exceptions');
    } finally {
        await browser.close();
        server.close();
    }
}