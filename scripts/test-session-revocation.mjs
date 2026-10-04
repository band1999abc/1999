// Run: node --test scripts/test-session-revocation.mjs
// An isolated child has ONLY dummy credentials. Every storage call is mocked.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('session verification fails closed without breaking public reads or normal login/logout', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', String.raw`
        import assert from 'node:assert/strict';
        import { Readable } from 'node:stream';
        import { createHmac } from 'node:crypto';
        let mode = 'clear';
        const denied = new Set();
        globalThis.fetch = async (input, options = {}) => {
            const url = new URL(input);
            assert.ok(url.hostname.endsWith('.invalid'), 'No real service may be contacted');
            const key = url.pathname.match(/revoked:([a-f0-9]+)/)?.[1];
            if (key) {
                if (mode === 'network') throw new Error('Simulated outage');
                if (mode === 'http') return new Response('{}', { status: 503 });
                if (mode === 'json') return new Response('invalid JSON');
                if (mode === 'shape') return Response.json({ error: 'invalid shape' });
                if (url.pathname.startsWith('/set/')) {
                    denied.add(key);
                    return Response.json({ result: 'OK' });
                }
                return Response.json({ result: mode === 'revoked' || denied.has(key) ? '1' : null });
            }
            if (url.pathname === '/pipeline') {
                return Response.json(JSON.parse(options.body).map(() => ({ result: '[]' })));
            }
            return Response.json({ result: '[]' });
        };
        const { makeToken, verifyToken, isRevoked } = await import('./api/_auth.js');
        const auth = (await import('./api/auth.js')).default;
        const resource = (await import('./api/[resource].js')).default;
        const detail = (await import('./api/[resource]/[id].js')).default;
        const analytics = (await import('./api/analytics.js')).default;
        const insights = (await import('./api/insights.js')).default;
        const milestones = (await import('./api/milestones.js')).default;
        const upload = (await import('./api/music-upload.js')).default;
        function request(method, token = '', body = {}, query = {}) {
            const req = Readable.from([Buffer.from(JSON.stringify(body))]);
            req.method = method;
            req.headers = token ? { authorization: 'Bearer ' + token } : {};
            req.url = '/api/auth';
            req.query = query;
            return req;
        }
        async function run(handler, req) {
            const res = {
                statusCode: 200, headers: {},
                setHeader(k, v) { this.headers[k] = v; },
                status(code) { this.statusCode = code; return this; },
                json(data) { this.data = data; return this; },
                end() { return this; },
            };
            await handler(req, res);
            return res;
        }
        const login = await run(auth, request('POST', '', { action: 'login', password: 'fixture-password' }));
        assert.equal(login.statusCode, 200);
        const token = login.data.token;
        assert.equal(verifyToken(token), 'Fixture');
        assert.equal(await isRevoked(token), false);
        assert.equal((await run(auth, request('GET', token))).statusCode, 200);
        const cookieReq = request('GET');
        cookieReq.headers.cookie = 'admin_session=' + token;
        assert.equal((await run(auth, cookieReq)).statusCode, 200);
        const conflicting = request('GET', 'invalid');
        conflicting.headers.cookie = 'admin_session=' + token;
        assert.equal((await run(auth, conflicting)).statusCode, 401);
        assert.equal((await run(analytics, conflicting)).statusCode, 401);
        assert.equal((await run(auth, request('POST', '', { action: 'login', password: 'wrong' }))).statusCode, 401);
        assert.equal((await run(auth, request('GET', 'invalid'))).statusCode, 401);
        const payload = Buffer.from(JSON.stringify({ exp: Date.now() - 1, member: 'Fixture' })).toString('base64url');
        const expired = payload + '.' + createHmac('sha256', 'fixture-secret').update(payload).digest('hex');
        assert.equal((await run(auth, request('GET', expired))).statusCode, 401);
        console.log('PASS normal login, Bearer, cookie, invalid password/token and expiry');
        for (const failure of ['network', 'http', 'json', 'shape', 'missing']) {
            mode = failure;
            if (failure === 'missing') delete process.env.UPSTASH_REDIS_REST_URL;
            assert.equal(await isRevoked(token), null, failure);
            for (const handler of [auth, analytics, insights, milestones]) {
                assert.equal((await run(handler, request('GET', token))).statusCode, 503, failure);
            }
            assert.equal((await run(resource, request('POST', token, {}, { resource: 'music' }))).statusCode, 503);
            assert.equal((await run(detail, request('PUT', token, {}, { resource: 'music', id: 'fixture' }))).statusCode, 503);
            assert.equal((await run(upload, request('POST', token, { type: 'blob.generate-client-token' }))).statusCode, 503);
            process.env.UPSTASH_REDIS_REST_URL = 'https://session.invalid';
            console.log('PASS all protected handlers reject ' + failure);
        }
        mode = 'network';
        for (const publicResource of ['music', 'diary', 'live']) {
            const req = request('GET', '', {}, { resource: publicResource });
            const res = await run(resource, req);
            assert.equal(res.statusCode, 200);
            assert.equal(req._authed, false);
            assert.ok(Array.isArray(res.data));
        }
        const signedPublic = request('GET', token, {}, { resource: 'diary' });
        assert.equal((await run(resource, signedPublic)).statusCode, 200);
        assert.equal(signedPublic._authed, false);
        console.log('PASS public reads remain unauthenticated and available during revocation outage');
        mode = 'revoked';
        assert.equal(await isRevoked(token), true);
        assert.equal((await run(auth, request('GET', token))).statusCode, 401);
        mode = 'clear';
        const logout = await run(auth, request('POST', token, { action: 'logout' }));
        assert.equal(logout.statusCode, 200);
        assert.ok(logout.headers['Set-Cookie'].includes('Max-Age=0'));
        assert.equal(await isRevoked(token), true);
        assert.equal((await run(auth, request('GET', token))).statusCode, 401);
        console.log('PASS normal logout revokes token and clears cookie');
    `], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: {
            PATH: process.env.PATH,
            SESSION_SECRET: 'fixture-secret',
            MEMBERS: JSON.stringify([{ name: 'Fixture', password: 'fixture-password' }]),
            UPSTASH_REDIS_REST_URL: 'https://session.invalid',
            UPSTASH_REDIS_REST_TOKEN: 'fixture-token',
            MUSIC_UPSTASH_REDIS_REST_URL: 'https://music.invalid',
            MUSIC_UPSTASH_REDIS_REST_TOKEN: 'fixture-token',
        },
        encoding: 'utf8',
        timeout: 30000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    console.log(result.stdout.trim());
});