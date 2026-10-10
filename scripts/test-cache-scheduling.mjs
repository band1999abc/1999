// Isolated fixtures only: no application secrets, real storage or deployed URLs.
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, request, run, dummyEnv } from './auth-review-fixture.mjs';

for (const key of Object.keys(process.env))
    if (!['PATH', 'HOME', 'PLAYWRIGHT_MODULE', 'CHROMIUM_PATH', 'NODE_TEST_CONTEXT'].includes(key))
        delete process.env[key];
Object.assign(process.env, dummyEnv);

test('F1: overdue list/detail publication writes once normally and never during revocation failure', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import { fixture, request, run } from './scripts/auth-review-fixture.mjs';
        const { makeToken } = await import('./api/_auth.js');
        const list = (await import('./api/[resource].js')).default;
        const detail = (await import('./api/[resource]/[id].js')).default;
        const failures = ['network','http','json','error-null','error-ok','missing','array','null',
            'result-false','result-zero','result-one','result-object','result-array'];
        for (const resource of ['diary','music']) for (const kind of ['list','detail'])
            for (const mode of ['clear',...failures])
                for (const id of ['future','pub']) {
                    const f = fixture();
                    f.records.find(x => x.id === 'future').scheduledAt = '2000-01-01T00:00';
                    f.setMode(mode);
                    const req = request('GET',makeToken('Fixture'),'',{}, {resource,id});
                    const res = await run(kind === 'list' ? list : detail,req);
                    const healthy = mode === 'clear';
                    assert.equal(req._authed, healthy);
                    assert.equal(res.statusCode, kind === 'list' || id === 'pub' || healthy ? 200 : 404);
                    assert.equal(f.writes.length, healthy ? 1 : 0,
                        resource + '/' + kind + '/' + mode + ': unexpected storage writes');
                    if (kind === 'list') {
                        assert.ok(res.data.some(x => x.id === 'pub'));
                        if (!healthy) assert.deepEqual(res.data.map(x => x.id), ['pub']);
                    } else if (healthy || id === 'pub') assert.equal(res.data.status,'published');
                    if (healthy) {
                        const command = f.writes[0];
                        const saved = JSON.parse(command[0] === 'EVAL' ? command[5] : command[2]);
                        assert.equal(saved.find(x => x.id === 'future').status,'published');
                    }
                }
        for (const resource of ['diary','music']) for (const kind of ['list','detail']) {
            const f = fixture();
            f.records.find(x => x.id === 'future').scheduledAt = '2000-01-01T00:00';
            const res = await run(kind === 'list' ? list : detail,
                request('GET','','',{}, {resource,id:'future'}));
            assert.equal(res.statusCode,200);
            assert.equal(f.writes.length,1,'Normal anonymous scheduled publication must remain available');
        }
        console.log('PASS F1: 112 signed scenarios; clear=1 write, 13 failures=0; anonymous normal=4 x 1 write');
    `], {
        cwd: new URL('../', import.meta.url),
        env: { PATH: process.env.PATH, HOME: '/tmp', ...dummyEnv },
        encoding: 'utf8', timeout: 30000,
    });
    console.log(result.stdout.trim());
    assert.equal(result.status, 0, result.stderr);
});

let browser;
before(async () => {
    const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
    browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'],
    });
});
after(async () => { await browser?.close(); });

// Playwright 1.40 treats a returned Promise as truthy in waitForFunction.
// Await observations in Node, and reject even if an observation never resolves.
async function waitUntil(label, observe, matches, { timeoutMs = 10000, intervalMs = 50 } = {}) {
    const deadline = performance.now() + timeoutMs;
    let lastValue, stopped = false, timer;
    const timeoutError = () => Object.assign(
        new Error(label + ' timed out after ' + timeoutMs + 'ms; last=' + JSON.stringify(lastValue)),
        { code: 'WAIT_TIMEOUT', lastValue }
    );
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { stopped = true; reject(timeoutError()); }, timeoutMs);
    });
    const polling = (async () => {
        while (!stopped) {
            lastValue = await observe();
            if (stopped || performance.now() >= deadline) throw timeoutError();
            if (matches(lastValue)) return lastValue;
            await delay(intervalMs);
        }
    })();
    try { return await Promise.race([polling, timeout]); }
    finally { stopped = true; clearTimeout(timer); }
}

const waitForOldCacheRemoval = (page, timeoutMs = 10000) => waitUntil(
    'v35 Cache Storage removal',
    () => page.evaluate(() => caches.keys()),
    keys => !keys.includes('1999-v35'),
    { timeoutMs }
);

// Read the actual previous worker from the immutable PR HEAD; never change Git.
const previousWorker = execFileSync('git', [
    'show', 'dedfeb5cd5cd1afcbc37ba7ae1ff1182cfce5858:sw.js',
], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
const currentWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
assert.match(previousWorker, /const CACHE = '1999-v35';/);
assert.match(currentWorker, /const CACHE = '1999-v36';/);
const appScript = readFileSync(new URL('../script.js', import.meta.url), 'utf8');
const registrationOffset = appScript.lastIndexOf('// Service Worker registration');
assert.ok(registrationOffset >= 0, 'Use the existing application registration code');
const registrationScript = appScript.slice(registrationOffset);

async function mediaFixture(resource, legacy, retainOldCache = false) {
    const f = fixture();
    let hits = 0, updated = false;
    const workerReads = [];
    let updatedWorker = currentWorker;
    if (retainOldCache) {
        assert.ok(currentWorker.includes('return k !== CACHE;'));
        // Fault injection in this loopback response ONLY, not the application file.
        updatedWorker = currentWorker.replace('return k !== CACHE;', 'return false;');
    }
    const image = Buffer.from(f.image.split(',')[1], 'base64');
    const detail = (await import('../api/[resource]/[id].js')).default;
    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://fixture.invalid');
            if (url.pathname === '/') {
                res.setHeader('Content-Type', 'text/html');
                res.setHeader('Cache-Control', 'no-store');
                res.end('<!doctype html><title>Isolated media fixture</title>' +
                    (legacy ? '<script>' + registrationScript + '</script>' : ''));
                return;
            }
            if (url.pathname === '/sw.js') {
                res.setHeader('Content-Type', 'application/javascript');
                res.setHeader('Cache-Control', 'no-store');
                workerReads.push(legacy && !updated ? '1999-v35' : '1999-v36');
                res.end(legacy && !updated ? previousWorker : updatedWorker);
                return;
            }
            if (url.pathname.startsWith('/api/')) {
                hits++;
                const input = request(req.method,'','',{}, {resource,id:'pub'});
                input.headers = req.headers;
                const result = await run(detail, input);
                // Simulate a previously distributed response, never actual production data.
                if (legacy && !updated && result.statusCode === 200)
                    result.headers['cache-control'] = 'public, max-age=86400';
                res.writeHead(result.statusCode,result.headers);
                res.end(typeof result.data === 'string' || Buffer.isBuffer(result.data)
                    ? result.data : JSON.stringify(result.data));
                return;
            }
            res.setHeader('Content-Type', url.pathname.endsWith('.png') ? 'image/png' : 'application/javascript');
            res.end(url.pathname.endsWith('.png') ? image : '/* isolated shell asset */');
        } catch (error) {
            res.writeHead(500); res.end(String(error));
        }
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    return {
        base: 'http://127.0.0.1:' + server.address().port,
        path: '/api/' + resource + '/pub?media=v2',
        makePrivate() { f.records.find(x => x.id === 'pub').status = 'draft'; },
        makePublic() { f.records.find(x => x.id === 'pub').status = 'published'; },
        releaseUpdate() { updated = true; },
        workerReads,
        hits() { return hits; },
        close: () => new Promise(resolve => server.close(resolve)),
    };
}

// Test-only observer: ask the actual controlling worker for its lexical CACHE
// value. Cache names alone do not prove that the new worker controls this page.
function observeWorkers(context) {
    const observers = new Map();
    const attach = worker => {
        if (!observers.has(worker)) {
            observers.set(worker, worker.evaluate(() => {
                self.addEventListener('message', event => {
                    if (event.data === 'isolated-audit-version')
                        event.ports[0].postMessage(CACHE);
                });
            }));
        }
        return observers.get(worker);
    };
    context.on('serviceworker', worker => { attach(worker).catch(() => {}); });
    return () => Promise.all(context.serviceWorkers().map(attach));
}

async function controllingVersion(page) {
    return page.evaluate(() => new Promise(resolve => {
        const channel = new MessageChannel();
        const finish = value => {
            clearTimeout(timer);
            channel.port1.close();
            channel.port2.close();
            resolve(value);
        };
        const timer = setTimeout(() => finish(null), 500);
        channel.port1.onmessage = event => finish(event.data);
        navigator.serviceWorker.controller?.postMessage(
            'isolated-audit-version', [channel.port2]
        );
    }));
}

const waitForVersion = (page, expected) => waitUntil(
    'controlling Worker ' + expected,
    () => controllingVersion(page),
    version => version === expected
);

test('Wait failures: false observations and hung observations must time out', async () => {
    await assert.rejects(waitUntil('always false', async () => false, value => value === true,
        { timeoutMs: 150 }), error => error.code === 'WAIT_TIMEOUT' && error.lastValue === false);
    await assert.rejects(waitUntil('hung observation', () => new Promise(() => {}), () => true,
        { timeoutMs: 150 }), error => error.code === 'WAIT_TIMEOUT');
    console.log('PASS intentional wait failures: false Promise and hung observation -> WAIT_TIMEOUT');
});

test('Playwright waitForFunction timeout is passed as the third argument', async () => {
    const page = await browser.newPage();
    try {
        await assert.rejects(
            page.waitForFunction(() => false, null, { timeout: 150 }),
            error => /^page\.waitForFunction: Timeout 150ms exceeded\./.test(error.message)
        );
        console.log('PASS intentional Playwright failure: synchronous false -> TimeoutError at 150ms');
    } finally { await page.close(); }
});

async function get(page, path) {
    return page.evaluate(async path => {
        const r = await fetch(path, { credentials: 'omit' });
        await r.arrayBuffer();
        return { status: r.status, cache: r.headers.get('cache-control') };
    }, path);
}
async function displayed(page, path) {
    return page.evaluate(path => new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(image.naturalWidth > 0);
        image.onerror = () => resolve(false);
        image.src = path;
    }), path);
}

for (const resource of ['music-jacket','flyer']) {
    test('F4: same URL published -> draft -> published without SW: ' + resource, async () => {
        const f = await mediaFixture(resource, false);
        const context = await browser.newContext({ serviceWorkers: 'block' });
        const page = await context.newPage();
        try {
            await page.goto(f.base);
            assert.equal((await get(page,f.path)).status,200);
            assert.equal(await displayed(page,f.path),true,'Published image must decode and display');
            f.makePrivate();
            const before = f.hits();
            assert.equal((await get(page,f.path)).status,404,'Same URL must not reuse a cached published image');
            assert.ok(f.hits() > before,'Anonymous retrieval must reach the server');
            await page.reload();
            assert.equal(await displayed(page,f.path),false,'Private image must not display on re-acquisition');
            f.makePublic();
            await page.reload();
            assert.deepEqual(await get(page,f.path),{status:200,cache:'private, no-store'});
            assert.equal(await displayed(page,f.path),true);
            console.log('PASS F4 '+resource+': same URL 200/display -> 404/no display -> 200/display; HTTP no-store');
        } finally { await context.close(); await f.close(); }
    });

    test('F4: running v35 -> v36 uses existing registration and bypasses old HTTP cache: ' + resource, async () => {
        const f = await mediaFixture(resource, true);
        const context = await browser.newContext({ serviceWorkers: 'allow' });
        const attachObservers = observeWorkers(context);
        const page = await context.newPage();
        try {
            await page.goto(f.base);
            await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
            await attachObservers();
            assert.equal(await waitForVersion(page,'1999-v35'),'1999-v35');
            assert.equal((await get(page,f.path)).status,200);
            f.makePrivate();
            const before = f.hits();
            assert.equal((await get(page,f.path)).status,200,'Establish real legacy HTTP cache');
            assert.equal(f.hits(),before,'Routing must not disable the HTTP cache');
            await page.evaluate(async path => {
                const stale = await caches.open('1999-v35');
                await stale.put(path,new Response('STALE-MEDIA'));
            }, f.path);
            assert.equal(await page.evaluate(path => caches.match(path).then(Boolean), f.path),true);
            f.releaseUpdate();
            // Re-run the existing registration through navigation; no manual update().
            await page.reload();
            assert.equal(await waitForVersion(page,'1999-v36'),'1999-v36');
            await waitForOldCacheRemoval(page);
            assert.ok(f.workerReads.includes('1999-v35') && f.workerReads.includes('1999-v36'));
            assert.equal((await get(page,f.path)).status,404,'New SW must bypass legacy HTTP cache at same URL');
            assert.ok(f.hits() > before);
            assert.equal(await displayed(page,f.path),false,'Private media must not display after re-acquisition');
            assert.equal(await page.evaluate(path => caches.match(path).then(Boolean), f.path),false,
                'API media must not be saved in the new Cache Storage');
            f.makePublic();
            assert.deepEqual(await get(page,f.path),{status:200,cache:'private, no-store'});
            assert.equal(await displayed(page,f.path),true);
            console.log('PASS F4 '+resource+': controller v35 -> v36; cached 200 -> same URL 404; old Cache Storage removed; public display works');
        } finally { await context.close(); await f.close(); }
    });

    test('F4: retained v35 cache must fail the removal wait: ' + resource, async () => {
        const f = await mediaFixture(resource, true, true);
        const context = await browser.newContext({ serviceWorkers: 'allow' });
        const attachObservers = observeWorkers(context);
        const page = await context.newPage();
        try {
            await page.goto(f.base);
            await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
            await attachObservers();
            assert.equal(await waitForVersion(page,'1999-v35'),'1999-v35');
            await page.evaluate(async path => {
                await (await caches.open('1999-v35')).put(path,new Response('STALE-MEDIA'));
            }, f.path);
            f.releaseUpdate();
            await page.reload();
            assert.equal(await waitForVersion(page,'1999-v36'),'1999-v36');
            await assert.rejects(waitForOldCacheRemoval(page,300), error =>
                error.code === 'WAIT_TIMEOUT' && error.lastValue.includes('1999-v35')
            );
            assert.equal(await page.evaluate(path => caches.match(path).then(Boolean),f.path),true,
                'The failure fixture really must retain the old entry');
            console.log('PASS intentional deletion failure '+resource+': controller v36 but v35 cache remains -> WAIT_TIMEOUT');
        } finally { await context.close(); await f.close(); }
    });
}
