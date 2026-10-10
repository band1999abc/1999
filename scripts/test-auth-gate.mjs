// Run with the read-only fixture: node scripts/test-audit-browser.mjs --serve
// Then: node scripts/test-auth-gate.mjs
// All auth responses are mocks. No real credentials or remote app requests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = 'http://127.0.0.1:8099';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true, args: ['--no-sandbox'],
});
const paths = ['', '/diary', '/live', '/analytics', '/music', '/messages',
    '/weather-phrases', '/members', '/insights', '/milestones'];

async function assertLocked(page) {
    assert.ok(await page.locator('body').evaluate(e => e.classList.contains('auth-hidden')));
    assert.equal(await page.locator('body > .card').isVisible(), false);
    assert.ok(await page.locator('body > .card').evaluate(e => e.inert));
    const focused = await page.evaluate(() => {
        document.activeElement.blur();
        document.getElementById('gate-probe').focus();
        return document.activeElement.id;
    });
    assert.notEqual(focused, 'gate-probe');
    await page.keyboard.press('Enter');
    for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => !!document.activeElement.closest('body > .card')), false);
    }
    assert.equal(await page.evaluate(() => window.__probeClicks), 0);
    assert.equal(await page.evaluate(() => window.__unauthorizedFrames), 0);
}

try {
    for (const suffix of (process.argv.includes('--cache-only') ? [] : paths)) {
        for (const mode of [401, 500, 503, 'network', 'json', 'false-ok', 200]) {
            const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 900 } });
            const errors = [];
            let release, managementRequests = 0;
            await context.route('**/*', async route => {
                const req = route.request(), url = new URL(req.url());
                if (!req.url().startsWith(base) || !['GET', 'HEAD'].includes(req.method())) return route.abort();
                if (url.pathname === '/analytics.js') return route.abort();
                if (url.pathname === '/api/auth') {
                    await new Promise(resolve => { release = resolve; });
                    if (mode === 'network') return route.abort();
                    return route.fulfill({
                        status: typeof mode === 'number' ? mode : 200,
                        contentType: 'application/json',
                        body: mode === 'json' ? '{' : JSON.stringify({ ok: mode === 200, member: 'Fixture' }),
                    });
                }
                if (/^\/api\/(?:music|diary|live|analytics|insights|milestones|messages|weather-phrases|members)(?:\/|$)/.test(url.pathname)) {
                    managementRequests++;
                }
                return route.continue();
            });
            await context.addInitScript(() => {
                if (location.pathname !== '/afterhours/login') {
                    sessionStorage.setItem('admin_token', 'fixture-only-token');
                }
                window.__authSucceeded = false;
                window.__unauthorizedFrames = 0;
                window.__probeClicks = 0;
                const originalFetch = window.fetch;
                window.fetch = async function (...args) {
                    const res = await originalFetch.apply(this, args);
                    if (String(args[0]) === '/api/auth' && res.ok) {
                        try { window.__authSucceeded = (await res.clone().json()).ok === true; } catch {}
                    }
                    return res;
                };
                function sample() {
                    const card = document.querySelector('body > .card');
                    if (card && card.getClientRects().length && getComputedStyle(card).visibility === 'visible' && !window.__authSucceeded) {
                        window.__unauthorizedFrames++;
                    }
                    requestAnimationFrame(sample);
                }
                requestAnimationFrame(sample);
            });
            const page = await context.newPage();
            page.on('pageerror', e => errors.push(e.message));
            await page.goto(base + '/afterhours' + suffix, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => typeof window._adminAuthFetch === 'function');
            while (!release) await page.waitForTimeout(10);
            await page.evaluate(() => {
                const probe = document.createElement('button');
                probe.id = 'gate-probe';
                probe.type = 'button';
                probe.textContent = 'Test-only management control';
                probe.addEventListener('click', () => window.__probeClicks++);
                document.querySelector('body > .card').appendChild(probe);
                const late = document.createElement('div');
                late.id = 'late-management-root';
                late.textContent = 'Late management root';
                document.body.appendChild(late);
            });
            await page.waitForTimeout(70);
            await assertLocked(page);
            assert.equal(managementRequests, 0, 'No management fetch before auth success');
            assert.ok(await page.locator('#late-management-root').evaluate(e => e.inert));
            release();
            if (mode === 401) {
                await page.waitForURL('**/afterhours/login');
                assert.equal(await page.evaluate(() => sessionStorage.getItem('admin_token')), null);
                console.log('UI /afterhours' + suffix + ' | 401 | expected=login | actual=login; pending locked');
            } else if (mode === 200) {
                await page.waitForFunction(() => !document.body.classList.contains('auth-hidden'));
                assert.ok(await page.locator('body > .card').isVisible());
                assert.equal(await page.locator('body > .card').evaluate(e => e.inert), false);
                assert.equal(await page.locator('#late-management-root').evaluate(e => e.inert), false);
                await page.locator('#gate-probe').focus();
                await page.keyboard.press('Enter');
                assert.equal(await page.evaluate(() => window.__probeClicks), 1);
                assert.equal(await page.evaluate(() => window.__unauthorizedFrames), 0);
                console.log('UI /afterhours' + suffix + ' | 200 | expected=visible/operable | actual=visible/operable');
            } else {
                await page.waitForSelector('#auth-status button');
                assert.ok((await page.locator('#auth-status').innerText()).includes('認証状態を確認できませんでした'));
                await assertLocked(page);
                assert.equal(managementRequests, 0, 'No management fetch on auth failure');
                assert.equal(await page.evaluate(() => sessionStorage.getItem('admin_token')), 'fixture-only-token');
                // Restore the mock; retry must reload and release the management gate.
                await context.route(base + '/api/auth', route => route.fulfill({ json: { ok: true } }));
                await page.locator('#auth-status button').focus();
                await page.keyboard.press('Enter');
                await page.waitForFunction(() => !document.body.classList.contains('auth-hidden'));
                assert.ok(await page.locator('body > .card').isVisible());
                assert.equal(await page.locator('body > .card').evaluate(e => e.inert), false);
                console.log('UI /afterhours' + suffix + ' | ' + mode + ' | expected=locked+error+retry | actual=locked+error+retry; recovery=200 visible');
            }
            assert.deepEqual(errors, [], suffix + ' ' + mode);
            await context.close();
        }
    }
    if (!process.argv.includes('--cache-only')) {
        console.log('PASS 10 management pages x 7 responses; pending/error focus, Tab, Enter, frame visibility and retry recovery');
    }
    const swContext = await browser.newContext({ serviceWorkers: 'allow' });
    await swContext.route('**/*', route => {
        const req = route.request();
        return req.url().startsWith(base) && ['GET', 'HEAD'].includes(req.method()) && new URL(req.url()).pathname !== '/analytics.js'
            ? route.continue() : route.abort();
    });
    const swPage = await swContext.newPage();
    await swPage.goto(base + '/api/auth');
    await swPage.evaluate(async () => {
        const stale = await caches.open('1999-v34');
        await stale.put('/admin.js?v=9', new Response('STALE-AUTH'));
        await stale.put('/admin.css?v=18', new Response('STALE-CSS'));
    });
    await swPage.goto(base + '/music.html', { waitUntil: 'networkidle' });
    await swPage.waitForFunction(() => navigator.serviceWorker.controller);
    const cached = await swPage.evaluate(async () => ({
        keys: await caches.keys(),
        js: await (await caches.match('/admin.js?v=9')).text(),
        css: await (await caches.match('/admin.css?v=18')).text(),
    }));
    assert.deepEqual(cached.keys, ['1999-v35']);
    assert.ok(cached.js.includes('originalInert'));
    assert.ok(cached.css.includes('body.auth-hidden > :not(#auth-status)'));
    await swContext.close();
    console.log('PASS auth cache migration v34 -> v35; fresh admin.js v9 and admin.css v18');
} finally {
    await browser.close();
}
