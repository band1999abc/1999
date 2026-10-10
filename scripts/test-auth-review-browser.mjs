// Only loopback HTTP fixtures and .invalid mock storage; never real credentials.
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fixture, request, run, dummyEnv } from './auth-review-fixture.mjs';

// Sanitize before importing application handlers.
for (const key of Object.keys(process.env))
    if (!['PATH','HOME','PLAYWRIGHT_MODULE','CHROMIUM_PATH'].includes(key)) delete process.env[key];
Object.assign(process.env, dummyEnv);
const f = fixture();
const { makeToken } = await import('../api/_auth.js');
const auth = (await import('../api/auth.js')).default;
const detail = (await import('../api/[resource]/[id].js')).default;
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
let browser, fixtureServer;
before(async () => {
    browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'],
    });
    fixtureServer = spawn(process.execPath, ['scripts/test-audit-browser.mjs','--serve'], {
        cwd: new URL('../', import.meta.url), env: { PATH: process.env.PATH, HOME: '/tmp' },
        stdio: ['ignore','pipe','pipe'],
    });
    await new Promise((resolve, reject) => {
        fixtureServer.once('error',reject);
        fixtureServer.once('exit',code=>reject(Error('Fixture exited '+code)));
        fixtureServer.stdout.on('data',chunk=>{if(String(chunk).includes('listening'))resolve();});
        fixtureServer.stderr.on('data',chunk=>reject(Error(String(chunk))));
    });
});
after(async () => { fixtureServer?.kill(); await browser?.close(); });

test('F4: private images cannot be reused anonymously; legacy cache cleared on logout', async () => {
    const token = makeToken('Fixture');
    let legacy = false, hits = 0, logoutHeaders;
    const server = createServer(async (req,res) => {
        const url = new URL(req.url,'http://fixture.invalid');
        if (url.pathname === '/') { res.end('<!doctype html><title>Isolated cache fixture</title>'); return; }
        if (!/^\/api\/(?:music-jacket|flyer)\//.test(url.pathname) && url.pathname !== '/api/auth') {
            res.writeHead(404); res.end('Not found'); return;
        }
        const query = url.pathname.split('/').filter(Boolean);
        const input = request(req.method);
        input.headers = req.headers;
        input.query = { resource:query[1], id:query[2] };
        input.url = req.url;
        if (url.pathname === '/api/auth') {
            const chunks = [];
            for await (const c of req) chunks.push(c);
            const result = await run(auth,request('POST',token,'',JSON.parse(Buffer.concat(chunks))));
            logoutHeaders = result.headers;
            res.writeHead(result.statusCode,result.headers);res.end(JSON.stringify(result.data));return;
        }
        hits++;
        const result = await run(detail,input);
        // A synthetic old response is intentionally cacheable, not application code.
        if(legacy && result.statusCode===200) result.headers['cache-control']='public, max-age=86400';
        res.writeHead(result.statusCode,result.headers);
        res.end(typeof result.data === 'object' && !Buffer.isBuffer(result.data)
            ? JSON.stringify(result.data) : result.data);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    const context=await browser.newContext({serviceWorkers:'block'});
    const page=await context.newPage();
    try {
        await page.goto(base);
        const get = (path,bearer='',cache) => page.evaluate(async({path,bearer,cache})=>{
            const response=await fetch(path,{credentials:'omit',cache,headers:bearer?{Authorization:'Bearer '+bearer}:{}});
            await response.arrayBuffer();
            return {status:response.status,cache:response.headers.get('cache-control')};
        },{path,bearer,cache});
        for(const r of ['music-jacket','flyer']) {
            f.denied.clear();f.setMode('clear');
            for(const id of ['draft','future']) {
                const path='/api/'+r+'/'+id;
                const warm=await get(path,token);
                assert.equal(warm.status,200);assert.equal(warm.cache,'private, no-store');
                f.setMode('network');
                assert.equal((await get(path)).status,404);
                f.setMode('clear');
            }
            assert.equal((await get('/api/'+r+'/pub')).cache,'private, no-store');
            console.log('F4 '+r+' | authenticated draft=200 private,no-store; anonymous=404; published also no-store');
        }
        legacy=true;f.denied.clear();
        const path='/api/music-jacket/draft?legacy=1';
        await get(path,token);
        const beforeHits=hits;
        assert.equal((await get(path)).status,200,'Confirm real HTTP cache was warmed');
        assert.equal(hits,beforeHits,'Playwright routing must NOT disable this cache');
        assert.equal((await get('/api/music-jacket/draft?media=v2')).status,404,
            'Versioned app references must avoid legacy private cache even without cache clearing');
        legacy=false;
        const logout=await page.evaluate(async()=>{
            const r=await fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({action:'logout'})});
            return {status:r.status,clear:r.headers.get('clear-site-data')};
        });
        assert.equal(logout.status,200);
        assert.equal(logoutHeaders['clear-site-data'],'"cache"');
        assert.equal((await get(path)).status,404,'Legacy private response must be removed from HTTP cache');
        console.log('F4 legacy public cache -> logout Clear-Site-Data -> anonymous 404');
    } finally {await context.close();await new Promise(resolve=>server.close(resolve));}
});

for(const suffix of ['', '/diary','/live','/analytics','/music','/messages',
    '/weather-phrases','/members','/insights','/milestones']) {
    test('F5: missing admin.js fails closed '+(suffix||'/dashboard'),async()=>{
        const context=await browser.newContext({serviceWorkers:'block'});
        let broken=true, management=0,authRequests=0;
        await context.addInitScript(()=>sessionStorage.setItem('admin_token','fixture-only'));
        await context.route('**/*',route=>{
            const url=new URL(route.request().url());
            if(url.origin!=='http://127.0.0.1:8099')return route.abort();
            if(url.pathname==='/admin.js'&&broken)return route.abort();
            if(url.pathname==='/analytics.js')return route.abort();
            if(url.pathname==='/api/auth') {
                authRequests++;
                return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});
            }
            if(/^\/api\/(?:music|diary|live|analytics|insights|milestones|messages|weather-phrases)(?:\/|$)/.test(url.pathname))management++;
            return route.continue();
        });
        const page=await context.newPage();
        try {
            await page.goto('http://127.0.0.1:8099/afterhours'+suffix,{waitUntil:'networkidle'});
            assert.equal(management,0,'No management request with missing common gate');
            assert.equal(authRequests,0);
            assert.equal(await page.locator('body > .card').isVisible(),false);
            assert.equal(await page.locator('body > .card').evaluate(e=>e.inert),true);
            assert.equal(await page.locator('#auth-status button').count(),1,'Failure explanation and retry required');
            assert.match(await page.locator('#auth-status').innerText(),/読み込/);
            await page.evaluate(()=>document.querySelector('body > .card button,body > .card a')?.focus());
            assert.equal(await page.evaluate(()=>!!document.activeElement.closest('body > .card')),false);
            for(let n=0;n<4;n++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('body > .card')),false);}
            broken=false;
            await page.locator('#auth-status button').click();
            await page.waitForFunction(()=>!document.body.classList.contains('auth-hidden'));
            assert.equal(await page.locator('body > .card').isVisible(),true);
            assert.equal(await page.locator('body > .card').evaluate(e=>e.inert),false);
            console.log('F5 '+(suffix||'/dashboard')+' | requests=0, hidden/inert, retry recovered');
        } finally {await context.close();}
    });
}

test('F2: failed logout clears local token but never claims server revocation',async()=>{
    const context=await browser.newContext({serviceWorkers:'block'});
    await context.addInitScript(()=>sessionStorage.setItem('admin_token','fixture-only'));
    await context.route('**/*',route=>{
        const url=new URL(route.request().url());
        if(url.origin!=='http://127.0.0.1:8099'||url.pathname==='/analytics.js')return route.abort();
        if(url.pathname==='/api/auth')return route.fulfill({
            status:route.request().method()==='POST'?503:200,contentType:'application/json',
            body:route.request().method()==='POST'?'{"ok":false,"revocationConfirmed":false}':'{"ok":true}',
        });
        return route.continue();
    });
    const page=await context.newPage();
    try{
        await page.goto('http://127.0.0.1:8099/afterhours',{waitUntil:'networkidle'});
        await page.locator('#signout-btn').focus();
        await page.keyboard.press('Enter');
        await page.waitForSelector('#auth-status');
        assert.equal(await page.evaluate(()=>sessionStorage.getItem('admin_token')),null);
        assert.equal(await page.locator('body > .card').isVisible(),false);
        assert.equal(await page.locator('body > .card').evaluate(e=>e.inert),true);
        assert.match(await page.locator('#auth-status').innerText(),/失効.*確認できません/);
        console.log('F2 UI | local token removed, server unconfirmed warning, management locked');
    }finally{await context.close();}
});
