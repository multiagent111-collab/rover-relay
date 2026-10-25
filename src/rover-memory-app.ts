import Fastify from 'fastify';
import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { MemoryAdapter, HMEM_REVISION } from './memory.ts';
import { acquireWriterLock, installLocalControl } from './lifecycle.ts';
import { RelayError } from './types.ts';

export const MEMORY_PATH = '/v1/integration/entrance';
export const MEMORY_AUDIENCE = 'relay2-entrance-memory';
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const place = z.enum(['library', 'auditorium']);
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('recall'), placeId: place }).strict(),
  z.object({ action: z.literal('confirm'), placeId: place, entrance: z.string().min(2).max(120)
    .refine(s => s === s.trim() && !/[\x00-\x1f\x7f]/.test(s)), expectedRevision: revision, confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal('forget'), placeId: place, expectedRevision: revision, confirmed: z.literal(true) }).strict(),
]);
const contextSchema = z.object({ v: z.literal('rover-memory-context-1.0'), sub: z.string().uuid(),
  tenant: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/), aud: z.literal(MEMORY_AUDIENCE),
  iat: z.number().int(), exp: z.number().int(), jti: z.string().uuid(),
  method: z.literal('POST'), path: z.literal(MEMORY_PATH), bodySha256: revision }).strict();

export function signMemoryContext(secret: string, claims: z.input<typeof contextSchema>) {
  const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return encoded + '.' + createHmac('sha256', secret).update(encoded).digest('base64url');
}
function equal(a: string, b: string) {
  const aa=Buffer.from(a), bb=Buffer.from(b);
  return aa.length===bb.length && timingSafeEqual(aa,bb);
}
type Options = { dataDir: string; internalToken: string; contextSecret: string; localControlToken?: string; clock?: () => number };

/** Private ROVER boundary. No browser session, provider mutation or execution capability. */
export function createRoverMemoryApp(options: Options) {
  if (options.internalToken.length<32 || options.contextSecret.length<32 || options.internalToken===options.contextSecret)
    throw Error('Configure distinct internal and signing credentials of at least 32 characters.');
  const root = resolve(options.dataDir);
  if (existsSync(root) && lstatSync(root).isSymbolicLink()) throw Error('Memory root must not be a symbolic link.');
  const lock = acquireWriterLock(root);
  try {
    const marker = join(root,'rover-memory-store.json');
    if (!existsSync(marker)) {
      if (readdirSync(root).some(n => n!=='.relay-writer.lock')) throw Error('Use a new dedicated ROVER memory directory.');
      writeFileSync(marker,JSON.stringify({kind:'rover-memory-integration-1.0',engineRevision:HMEM_REVISION})+'\n',{flag:'wx',mode:0o600});
    } else {
      if (lstatSync(marker).isSymbolicLink()) throw Error('Invalid store marker.');
      const stored=JSON.parse(readFileSync(marker,'utf8'));
      if (stored.kind!=='rover-memory-integration-1.0' || stored.engineRevision!==HMEM_REVISION) throw Error('Unexpected integration store.');
    }
    const replayFile = join(root,'context-replay.json');
    const replaySchema = z.array(z.tuple([z.string().uuid(), z.number().int()])).max(2048);
    let replay = new Map<string,number>();
    if (existsSync(replayFile)) {
      if(lstatSync(replayFile).isSymbolicLink() || lstatSync(replayFile).size>262144) throw Error('Invalid replay journal.');
      replay = new Map(replaySchema.parse(JSON.parse(readFileSync(replayFile,'utf8'))));
    }
    const now = () => Math.floor((options.clock ?? Date.now)()/1000);
    const memory = new MemoryAdapter(join(root,'hmem'),options.clock);
    const app = Fastify({logger:false,bodyLimit:4096,requestTimeout:5000});
    app.addContentTypeParser('application/json',{parseAs:'buffer'},(_req,body,done)=>done(null,body));
    app.addHook('onClose',async()=>lock.release());
    app.setErrorHandler((error,_req,reply)=>reply.code(error && typeof error==='object' && 'statusCode' in error && error.statusCode===413?413:503)
      .send({error:'memory_unavailable',execution:'none'}));
    app.get('/v1/health',async()=>({status:'ok',contractVersion:'entrance-memory-1.0',engineRevision:HMEM_REVISION,execution:'none'}));
    app.post(MEMORY_PATH,async(request,reply)=>{
      reply.header('Cache-Control','no-store');
      try {
        if (!equal(String(request.headers.authorization ?? ''),'Bearer '+options.internalToken)) throw new RelayError(401,'invalid_context','Unauthorized');
        const signed=String(request.headers['x-rover-memory-context'] ?? '');
        if(signed.length>2048) throw new RelayError(401,'invalid_context','Unauthorized');
        const parts=signed.split('.');
        if(parts.length!==2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!) ||
          !equal(parts[1]!,createHmac('sha256',options.contextSecret).update(parts[0]!).digest('base64url')))
          throw new RelayError(401,'invalid_context','Unauthorized');
        const claims=contextSchema.safeParse(JSON.parse(Buffer.from(parts[0]!,'base64url').toString('utf8')));
        if(!claims.success) throw new RelayError(401,'invalid_context','Unauthorized');
        const c=claims.data, timestamp=now();
        const raw=Buffer.isBuffer(request.body)?request.body:Buffer.alloc(0);
        if(c.iat>timestamp+5 || c.iat<timestamp-30 || c.exp<=timestamp || c.exp<=c.iat || c.exp-c.iat>30 ||
          c.bodySha256!==digest(raw) || request.url!==MEMORY_PATH || request.method!==c.method || replay.has(c.jti))
          throw new RelayError(401,'invalid_context','Unauthorized');
        const parsed=input.safeParse(JSON.parse(raw.toString('utf8')));
        if(!parsed.success) throw new RelayError(400,'invalid_memory_request','Invalid entrance request');
        for(const [id,expiry] of replay) if(expiry<=timestamp) replay.delete(id);
        if(replay.size>=2048) throw new RelayError(503,'memory_unavailable','Replay capacity exceeded');
        replay.set(c.jti,c.exp);
        const pending=join(root,'.replay-'+randomUUID()+'.tmp');
        writeFileSync(pending,JSON.stringify([...replay])+'\n',{flag:'wx',mode:0o600});
        renameSync(pending,replayFile);
        const value=parsed.data, identity={user:c.sub,tenant:c.tenant};
        let result=memory.recall(identity,value.placeId);
        if(value.action!=='recall') {
          if(result.revision!==value.expectedRevision) throw new RelayError(409,'memory_revision_conflict','Recall before changing entrance');
          result=value.action==='confirm'?memory.set(identity,value.placeId,value.entrance):memory.forget(identity,value.placeId);
        }
        console.log(JSON.stringify({event:'rover_entrance_memory',action:value.action,placeId:value.placeId,
          engineRevision:HMEM_REVISION,contextRevision:result.revision,execution:'none'}));
        return {contractVersion:'entrance-memory-1.0',execution:'none',bookingCreated:false,
          placeId:value.placeId,status:result.entrance===null?'empty':'available',entrance:result.entrance,
          contextRevision:result.revision,engineRevision:HMEM_REVISION,engine:'Meterless H-MEM',
          decision:value.action==='recall'?'confirmed_entrance_recalled':value.action==='confirm'?'entrance_explicitly_confirmed':'future_entrance_influence_forgotten'};
      } catch(error) {
        const status=error instanceof RelayError?error.status:503;
        const code=error instanceof RelayError?error.code:'memory_unavailable';
        return reply.code(status).send({error:code,execution:'none',bookingCreated:false});
      }
    });
    installLocalControl(app,options.localControlToken);
    return app;
  } catch(error) {lock.release(); throw error;}
}
