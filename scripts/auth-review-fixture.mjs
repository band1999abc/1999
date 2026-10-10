// Shared isolated fixture: never import this from application code.
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';

export const dummyEnv = {
    SESSION_SECRET: 'fixture-secret',
    ADMIN_PASSWORD: 'fixture-password',
    MEMBERS: '[{"name":"Fixture","password":"fixture-password"}]',
    UPSTASH_REDIS_REST_URL: 'https://session.invalid',
    UPSTASH_REDIS_REST_TOKEN: 'fixture-rest-token',
    MUSIC_UPSTASH_REDIS_REST_URL: 'https://music.invalid',
    MUSIC_PUBLIC_BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_fixture_dummy',
    VERCEL_BLOB_CALLBACK_URL: 'https://fixture.invalid/api/music-upload',
};
export const digest = token => createHash('sha256').update(token).digest('hex').slice(0, 32);
export function signed(data) {
    const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)).toString('base64url');
    return payload + '.' + createHmac('sha256', dummyEnv.SESSION_SECRET).update(payload).digest('hex');
}
export function fixture() {
    let mode = 'clear';
    const denied = new Set(), reads = [], writes = [];
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
    const records = ['pub', 'draft', 'future'].map(id => ({
        id, title: 'Fixture', body: 'Fixture', date: '2099-01-01',
        releaseDate: '2026-01-01', venue: 'Fixture', jacket: true, flyer: true,
        status: id === 'pub' ? 'published' : id === 'draft' ? 'draft' : 'scheduled',
        scheduledAt: '2099-01-01T00:00', enabled: id === 'pub',
    }));
    globalThis.fetch = async (input, options = {}) => {
        const url = new URL(input);
        assert.ok(url.hostname.endsWith('.invalid'), 'Real network is forbidden');
        const key = url.pathname.match(/revoked:([a-f0-9]+)/)?.[1];
        if (key) {
            if (url.pathname.startsWith('/get/')) reads.push(key);
            if (mode === 'network') throw Error('Simulated outage');
            if (mode === 'http') return new Response('{}', { status: 503 });
            if (mode === 'json') return new Response('{');
            if (mode === 'error-null') return Response.json({ error: 'Simulated failure', result: null });
            if (mode === 'error-ok') return Response.json({ error: 'Simulated failure', result: 'OK' });
            if (mode === 'missing') return Response.json({});
            if (mode === 'array') return Response.json([]);
            if (mode === 'null') return Response.json(null);
            if (mode === 'result-false') return Response.json({result:false});
            if (mode === 'result-zero') return Response.json({result:0});
            if (mode === 'result-one') return Response.json({result:1});
            if (mode === 'result-object') return Response.json({result:{}});
            if (mode === 'result-array') return Response.json({result:[]});
            if (url.pathname.startsWith('/set/')) {
                if (mode === 'no-ack') return Response.json({ result: null });
                denied.add(key);
                return Response.json({ result: 'OK' });
            }
            return Response.json({ result: denied.has(key) ? '1' : null });
        }
        assert.equal(url.pathname, '/pipeline');
        return Response.json(JSON.parse(options.body).map(command => {
            const [op, k] = command;
            if (!['GET', 'LRANGE', 'EXISTS'].includes(op)) writes.push(command);
            let result = 'OK';
            if (op === 'GET') result = /flyer:|music:jacket:/.test(k) ? image
                : /analytics/.test(k) ? null : /milestones/.test(k) ? '{}'
                : JSON.stringify(records);
            if (op === 'LRANGE') result = [];
            if (op === 'EXISTS') result = 0;
            // A successful synthetic compare-and-set for scheduled Music publication.
            if (op === 'EVAL') {
                assert.equal(command[4], JSON.stringify(records));
                assert.ok(Array.isArray(JSON.parse(command[5])));
                result = 1;
            }
            return { result };
        }));
    };
    return { denied, reads, writes, records, image, setMode(value) { mode = value; } };
}
export function request(method = 'GET', bearer = '', cookie = '', body = {}, query = {}) {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = method;
    req.headers = {};
    if (bearer) req.headers.authorization = 'Bearer ' + bearer;
    if (cookie) req.headers.cookie = 'admin_session=' + cookie;
    req.query = query;
    req.url = '/api/fixture';
    return req;
}
export async function run(handler, req) {
    const res = {
        statusCode: 200, headers: {},
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        status(code) { this.statusCode = code; return this; },
        json(data) { this.data = data; return this; },
        send(data) { this.data = data; return this; },
        end(data) { this.data = data; return this; },
        redirect(code, url) { this.statusCode = code; this.headers.location = url; return this; },
    };
    await handler(req, res);
    return res;
}
