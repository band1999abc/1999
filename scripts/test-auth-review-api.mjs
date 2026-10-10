// node --test scripts/test-auth-review-api.mjs
// Each scenario runs in a child with exclusively dummy credentials.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { dummyEnv } from './auth-review-fixture.mjs';

const setup = String.raw`
    import assert from 'node:assert/strict';
    import { createServer, request as httpRequest } from 'node:http';
    import { fixture, request, run, signed, digest } from './scripts/auth-review-fixture.mjs';
    const f = fixture();
    const { makeToken, verifyToken } = await import('./api/_auth.js');
    const auth = (await import('./api/auth.js')).default;
    const resource = (await import('./api/[resource].js')).default;
    const detail = (await import('./api/[resource]/[id].js')).default;
    const analytics = (await import('./api/analytics.js')).default;
    const insights = (await import('./api/insights.js')).default;
    const milestones = (await import('./api/milestones.js')).default;
    const upload = (await import('./api/music-upload.js')).default;
    const b = makeToken('BearerFixture'), c = makeToken('CookieFixture');
    const managers = [[auth, {}], [analytics, {}], [insights, {}], [milestones, {}],
        [detail, {resource:'messages',id:'draft'}], [detail, {resource:'weather-phrases',id:'draft'}]];
`;
function scenario(name, code) {
    test(name, () => {
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', setup + code], {
            cwd: new URL('../', import.meta.url),
            env: { PATH: process.env.PATH, HOME: '/tmp', ...dummyEnv }, encoding: 'utf8',
        });
        console.log(result.stdout);
        assert.equal(result.status, 0, result.stderr);
    });
}
scenario('F1: every revocation failure rejects protected requests, with zero writes', String.raw`
    const updates = [];
    for (const resource of ['diary','live','music','messages','weather-phrases'])
        updates.push([resource, '', 'POST']);
    for (const resource of ['diary','live','music','messages','weather-phrases'])
        for (const method of ['PUT','DELETE']) updates.push([resource,'draft',method]);
    for (const [resource, methods] of [
        ['flyer',['POST','PUT','DELETE']], ['music-jacket',['POST','DELETE']],
        ['member-photo',['POST','DELETE']], ['music-file',['POST','DELETE']],
    ]) for (const method of methods) updates.push([resource,'draft',method]);
    for (const mode of ['network','http','json','error-null','error-ok','missing','array','null',
        'result-false','result-zero','result-one','result-object','result-array']) {
        f.setMode(mode);
        for (const [handler, query] of managers)
            assert.equal((await run(handler,request('GET',b,'',{},query))).statusCode,503,mode+' GET');
        for (const [r,id,method] of updates) {
            const handler = id ? detail : resource;
            for (const [token,expected] of [[b,503],['invalid',401]]) {
                const res = await run(handler, request(method,token,c,
                    {date:'2099-01-01',title:'Fixture',body:'Fixture'},
                    {resource:r,id}));
                assert.equal(res.statusCode,expected,mode+' '+method+' '+r);
            }
        }
        for (const [token, expected] of [[b,503],['invalid',401]])
            assert.equal((await run(upload,request('POST',token,c,{type:'blob.generate-client-token'}))).statusCode,expected);
        assert.equal(f.writes.length,0,mode+' writes must remain zero');
        for (const r of ['diary','live','music','messages','weather-phrases']) {
            const res = await run(resource,request('GET',b,'',{}, {resource:r}));
            assert.equal(res.statusCode,200);
            assert.ok(res.data.every(x=>x.id==='pub'),'Public read must not leak '+r);
        }
        console.log('F1 '+mode+' | valid=503 invalid=401 | 25 protected mutations, writes=0; public GET=200');
    }
`);
scenario('F2: logout confirms revocation or returns failure, never false success', String.raw`
    for (const mode of ['network','http','json','error-null','error-ok','missing','array','null','no-ack']) {
        f.setMode(mode);
        const res = await run(auth,request('POST',b,'',{action:'logout'}));
        assert.equal(res.statusCode,503,mode);
        assert.equal(res.data.ok,false);
        assert.equal(res.data.revocationConfirmed,false);
        assert.match(res.headers['set-cookie'],/Max-Age=0/);
        assert.equal(res.headers['clear-site-data'],'"cache"');
        f.setMode('clear');
        assert.equal((await run(auth,request('GET',b))).statusCode,200,'Failed revocation must not be falsely claimed');
        console.log('F2 '+mode+' | logout=503, local cookie cleared, server unconfirmed, retained token=200');
    }
    for (const cookieOnly of [false,true]) {
        f.denied.clear();
        const res = await run(auth,request('POST',cookieOnly?'':b,cookieOnly?b:'',{action:'logout'}));
        assert.equal(res.statusCode,200);
        assert.equal(res.data.revocationConfirmed,true);
        assert.equal((await run(auth,request('GET',b))).statusCode,401);
        assert.equal((await run(detail,request('GET',b,'',{}, {resource:'music',id:'draft'}))).statusCode,404);
        console.log('F2 normal '+(cookieOnly?'Cookie':'Bearer')+' | logout=200, replay=401, private detail=404');
    }
`);
scenario('F3: one credential selection for every management handler and complete conflict matrix', String.raw`
    const targets = [...managers, [resource,{resource:'music'}], [detail,{resource:'music',id:'draft'}],
        [upload,{}]];
    const rows = [
        ['valid B+valid C',b,c,[],200,b],
        ['invalid B+valid C','invalid',c,[],401,'invalid'],
        ['revoked B+valid C',b,c,[b],401,b],
        ['valid B+revoked C',b,c,[c],200,b],
        ['valid C only','',c,[],200,c],
        ['valid B only',b,'',[],200,b],
        ['invalid C only','','invalid',[],401,'invalid'],
        ['revoked C only','',c,[c],401,c],
        ['both revoked',b,c,[b,c],401,b],
        ['no credentials','','',[],401,''],
        ['NBSP B+valid C','\u00a0',c,[],401,'\u00a0'],
        ['empty B+valid C','',c,[],401,'',true],
    ];
    const expired = signed({exp:Date.now()-1,member:'ExpiredFixture'});
    const states = ['absent','valid','invalid','revoked','expired'];
    for (const bs of states) for (const cs of states) {
        const bearer = bs==='absent'?'':bs==='invalid'?'invalid':bs==='expired'?expired:b;
        const cookie = cs==='absent'?'':cs==='invalid'?'invalid':cs==='expired'?expired:c;
        const revoked = [...(bs==='revoked'?[b]:[]),...(cs==='revoked'?[c]:[])];
        const active = bs==='absent'?cs:bs;
        rows.push(['matrix B='+bs+' C='+cs,bearer,cookie,revoked,active==='valid'?200:401,bearer||cookie]);
    }
    for (const [name,bearer,cookie,revoked,expected,selected,empty] of rows) {
        f.denied.clear(); for(const t of revoked) f.denied.add(digest(t));
        for(const [handler,query] of targets) {
            const req=request(handler===upload?'POST':'GET',bearer,cookie,
                handler===upload?{type:'blob.generate-client-token',payload:{
                    pathname:'music/draft/v1-fixture.mp3',clientPayload:'{"musicId":"draft"}',
                }}:{},query);
            if(empty)req.headers.authorization='Bearer';
            let count=0;const header=req.headers.authorization;
            Object.defineProperty(req.headers,'authorization',{get(){count++;return count===1?header:'Bearer '+c;}});
            const start=f.reads.length, res=await run(handler,req);
            assert.equal(count,1,name+' selection count');
            assert.deepEqual(f.reads.slice(start),verifyToken(selected)!==null?[digest(selected)]:[],name+' selected revocation credential');
            const publicGet=handler===resource;
            const publicDetail=handler===detail&&query.resource==='music';
            const status=publicGet?200:publicDetail&&expected===401?404:expected;
            assert.equal(res.statusCode,status,name+' '+JSON.stringify(query));
        }
        console.log('F3 '+name+' | selected='+(empty||bearer?'Bearer':cookie?'Cookie':'none')+' | management='+expected);
    }
    f.denied.clear();
    const handlers={auth,analytics,insights,milestones};
    const server=createServer(async(req,res)=>{
        req.query={};
        res.status=function(code){this.statusCode=code;return this;};
        res.json=function(data){this.end(JSON.stringify(data));return this;};
        await handlers[req.url.slice(1)](req,res);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
        for(const name of Object.keys(handlers)) for(const header of ['Bearer \u00a0','Bearer\u00a0','Bearer','bEaReR\t']) {
            const status=await new Promise((resolve,reject)=>{
                const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path:'/'+name,
                    headers:{Authorization:header,Cookie:'admin_session='+c}},res=>{
                    res.resume();res.on('end',()=>resolve(res.statusCode));
                });
                req.on('error',reject);req.end();
            });
            assert.equal(status,401);
            console.log('F3 REAL HTTP malformed/empty Bearer + Cookie | '+name+'=401');
        }
    } finally {await new Promise(resolve=>server.close(resolve));}
`);
scenario('F6: malformed expiry denied, canonical existing tokens remain compatible', String.raw`
    const bad = [
        ['missing',{member:'Fixture'}],['null',{exp:null}],['string',{exp:String(Date.now()+100000)}],
        ['NaN-equivalent',{exp:'NaN'}],['infinite','{"exp":1e309}'],['array',[]],['boolean',{exp:true}],
        ['object',{exp:{}}],['zero',{exp:0}],['negative',{exp:-1}],['expired',{exp:Date.now()-1}],
        ['unsafe-range',{exp:1e308}],['invalid-date',{exp:Number.MAX_SAFE_INTEGER}],
        ['fractional',{exp:Date.now()+60000.5}],
    ];
    for(const[name,data]of bad) {
        const token=signed(data);
        assert.equal(verifyToken(token),null,name);
        assert.equal((await run(auth,request('GET',token,c))).statusCode,401,name);
        const res=await run(resource,request('POST',token,c,{date:'2099-01-01',title:'Fixture',body:'Fixture'}, {resource:'diary'}));
        assert.equal(res.statusCode,401,name);
        assert.equal(f.writes.length,0);
        console.log('F6 '+name+' | 401, writes=0');
    }
    for(const token of [makeToken('Fixture'), signed({exp:Date.now()+60000})]) {
        for(const[h,q]of managers)assert.equal((await run(h,request('GET',token,'',{},q))).statusCode,200);
    }
    const login=await run(auth,request('POST','','',{action:'login',password:'fixture-password'}));
    assert.equal(login.statusCode,200);assert.equal(verifyToken(login.data.token),'Fixture');
    console.log('F6 new and legacy numeric-exp tokens: management=200; login=200');
`);
