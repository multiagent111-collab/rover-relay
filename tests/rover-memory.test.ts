import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRoverMemoryApp, signMemoryContext, MEMORY_PATH, MEMORY_AUDIENCE } from '../src/rover-memory-app.ts';
import { ownerKey } from '../src/domain.ts';

const token='controlled-internal-credential-0000000000000001';
const secret='controlled-signed-context-key-00000000000000001';
const user='30000000-0000-4000-8000-000000000001';
const tenant='relay-local-test';
const options=(root:string)=>({dataDir:root,internalToken:token,contextSecret:secret});
const body=(action='recall',extra:Record<string,unknown>={})=>({action,placeId:'library',...extra});
function signed(payload:unknown, overrides:Record<string,unknown>={}) {
  const raw=JSON.stringify(payload), now=Math.floor(Date.now()/1000);
  const claims={v:'rover-memory-context-1.0' as const,sub:user,tenant,aud:MEMORY_AUDIENCE,
    iat:now,exp:now+30,jti:randomUUID(),method:'POST' as const,path:MEMORY_PATH,
    bodySha256:createHash('sha256').update(raw).digest('hex'),...overrides};
  return {raw,context:signMemoryContext(secret,claims as Parameters<typeof signMemoryContext>[1])};
}
async function call(app:ReturnType<typeof createRoverMemoryApp>, payload:unknown, claims:Record<string,unknown>={}) {
  const request=signed(payload,claims);
  return app.inject({method:'POST',url:MEMORY_PATH,payload:request.raw,
    headers:{'content-type':'application/json',authorization:'Bearer '+token,'x-rover-memory-context':request.context}});
}
function directory() { return mkdtempSync(join(tmpdir(),'rover-hmem-phase2-')); }
function clean(root:string) {
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep) && root.includes('rover-hmem-phase2-'));
  rmSync(root,{recursive:true,force:true});
}

test('official H-MEM confirmation, correction, forget and persistent revision receipts',async()=>{
  const root=directory(); const app=createRoverMemoryApp(options(root));
  try {
    const empty=(await call(app,body())).json(); assert.equal(empty.status,'empty');
    const north=(await call(app,body('confirm',{confirmed:true,entrance:'North entrance',expectedRevision:empty.contextRevision}))).json();
    assert.equal(north.engine,'Meterless H-MEM'); assert.equal(north.entrance,'North entrance');
    assert.equal((await call(app,body())).json().contextRevision,north.contextRevision);
    const south=(await call(app,body('confirm',{confirmed:true,entrance:'South entrance',expectedRevision:north.contextRevision}))).json();
    assert.equal(south.entrance,'South entrance'); assert.notEqual(south.contextRevision,north.contextRevision);
    const forgotten=(await call(app,body('forget',{confirmed:true,expectedRevision:south.contextRevision}))).json();
    assert.equal(forgotten.entrance,null); assert.equal((await call(app,body())).json().status,'empty');
    const ledger=readFileSync(join(root,'hmem',ownerKey({tenant,user}),'library','ledger.jsonl'),'utf8');
    assert.ok(ledger.includes('North entrance') && ledger.includes('delete'));
    assert.equal(forgotten.execution,'none'); assert.equal(forgotten.bookingCreated,false);
  } finally {await app.close();clean(root);}
});
test('same place is isolated by verified subject, tenant and place',async()=>{
  const root=directory(),app=createRoverMemoryApp(options(root));
  try {
    const initial=(await call(app,body())).json();
    await call(app,body('confirm',{confirmed:true,entrance:'North entrance',expectedRevision:initial.contextRevision}));
    for(const alternate of [{sub:'30000000-0000-4000-8000-000000000002'},{tenant:'other-test-tenant'}])
      assert.equal((await call(app,body(),alternate)).json().entrance,null);
    assert.equal((await call(app,body('recall',{placeId:'auditorium'}))).json().entrance,null);
    assert.equal((await call(app,body())).json().entrance,'North entrance');
  } finally {await app.close();clean(root);}
});
test('both credentials, fixed audience/path, expiry, body digest and schema are enforced',async()=>{
  const root=directory(),app=createRoverMemoryApp(options(root));
  try {
    const good=signed(body());
    for(const headers of [{},{authorization:'Bearer '+token},{'x-rover-memory-context':good.context},
      {authorization:'Bearer public-demo-token','x-rover-memory-context':good.context}])
      assert.equal((await app.inject({method:'POST',url:MEMORY_PATH,payload:good.raw,headers:{'content-type':'application/json',...headers}})).statusCode,401);
    const now=Math.floor(Date.now()/1000);
    for(const claims of [{aud:'browser-demo'},{exp:now-1},{iat:now+100,exp:now+120},{iat:now-40,exp:now+10},{method:'GET'},{path:'/other'},{bodySha256:'0'.repeat(64)},{sub:'not-a-subject'}])
      assert.equal((await call(app,body(),claims)).statusCode,401);
    assert.equal((await call(app,body('recall',{tenant:'caller-selected-tenant'}))).statusCode,400);
    assert.equal((await call(app,body('recall',{placeId:'arbitrary address'}))).statusCode,400);
    assert.equal((await call(app,body('confirm',{confirmed:false,entrance:'North entrance',expectedRevision:'0'.repeat(64)}))).statusCode,400);
  } finally {await app.close();clean(root);}
});
test('signed contexts cannot be replayed, including after process lifecycle restart',async()=>{
  const root=directory();let app=createRoverMemoryApp(options(root));
  try {
    const signedBody=signed(body());
    const req={method:'POST' as const,url:MEMORY_PATH,payload:signedBody.raw,
      headers:{'content-type':'application/json',authorization:'Bearer '+token,'x-rover-memory-context':signedBody.context}};
    assert.equal((await app.inject(req)).statusCode,200);
    assert.equal((await app.inject(req)).statusCode,401);
    await app.close(); app=createRoverMemoryApp(options(root));
    assert.equal((await app.inject(req)).statusCode,401);
  } finally {await app.close();clean(root);}
});
test('stale corrections and forgetting cannot overwrite a newer explicit preference',async()=>{
  const root=directory(),app=createRoverMemoryApp(options(root));
  try {
    const old=(await call(app,body())).json();
    await call(app,body('confirm',{confirmed:true,entrance:'North entrance',expectedRevision:old.contextRevision}));
    for(const action of ['confirm','forget']) {
      const value=body(action,{confirmed:true,expectedRevision:old.contextRevision,...(action==='confirm'?{entrance:'South entrance'}:{})});
      assert.equal((await call(app,value)).statusCode,409);
    }
    assert.equal((await call(app,body())).json().entrance,'North entrance');
  } finally {await app.close();clean(root);}
});
test('corrupt official store is blocked without erasing it or substituting a preference',async()=>{
  const root=directory(),app=createRoverMemoryApp(options(root));
  try {
    await call(app,body());
    const path=join(root,'hmem',ownerKey({tenant,user}),'library','state.json');
    writeFileSync(path,'corrupt-private-test-state');
    const response=await call(app,body()); assert.equal(response.statusCode,503);
    assert.equal(readFileSync(path,'utf8'),'corrupt-private-test-state');
    assert.equal((await call(app,body('recall',{placeId:'auditorium'}))).statusCode,200);
  } finally {await app.close();clean(root);}
});
test('a second writer and an existing unrelated judging directory are refused',async()=>{
  const root=directory(),app=createRoverMemoryApp(options(root));
  try {assert.throws(()=>createRoverMemoryApp(options(root)),/locked/);}
  finally {await app.close();clean(root);}
  const existing=directory(); writeFileSync(join(existing,'relay.sqlite'),'preserved judging data');
  try {
    assert.throws(()=>createRoverMemoryApp(options(existing)),/dedicated/);
    assert.equal(readFileSync(join(existing,'relay.sqlite'),'utf8'),'preserved judging data');
  } finally {clean(existing);}
});
test('real serial OS processes recall the same confirmed entrance and then forget it',()=>{
  const root=directory();
  try {
    const reports=['seed','resume','forget','verify'].map(phase=>{
      const result=spawnSync(process.execPath,['--import','tsx','tests/helpers/rover-memory-worker.ts',phase,root],
        {cwd:process.cwd(),encoding:'utf8',windowsHide:true,timeout:30000});
      assert.equal(result.status,0,result.stderr);
      return JSON.parse(result.stdout.trim().split('\n').at(-1)!);
    });
    assert.equal(new Set(reports.map(r=>r.pid)).size,4);
    assert.equal(reports[1].entrance,'North entrance'); assert.equal(reports[3].entrance,null);
    assert.equal(reports[0].revision,reports[1].revision);
  } finally {clean(root);}
});
