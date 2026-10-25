import { createHash, randomUUID } from 'node:crypto';
import { createRoverMemoryApp, signMemoryContext, MEMORY_PATH, MEMORY_AUDIENCE } from '../../src/rover-memory-app.ts';
const [phase,root]=process.argv.slice(2);
const secret='controlled-signed-context-key-00000000000000001',token='controlled-internal-credential-0000000000000001';
const app=createRoverMemoryApp({dataDir:root!,contextSecret:secret,internalToken:token});
async function call(body:Record<string,unknown>) {
  const raw=JSON.stringify(body),now=Math.floor(Date.now()/1000);
  const context=signMemoryContext(secret,{v:'rover-memory-context-1.0',sub:'30000000-0000-4000-8000-000000000001',
    tenant:'relay-local-test',aud:MEMORY_AUDIENCE,iat:now,exp:now+30,jti:randomUUID(),method:'POST',path:MEMORY_PATH,
    bodySha256:createHash('sha256').update(raw).digest('hex')});
  const result=await app.inject({method:'POST',url:MEMORY_PATH,payload:raw,
    headers:{'content-type':'application/json',authorization:'Bearer '+token,'x-rover-memory-context':context}});
  if(result.statusCode!==200) throw Error('Worker memory request failed');
  return result.json();
}
try {
  let current=await call({action:'recall',placeId:'library'});
  if(phase==='seed') current=await call({action:'confirm',placeId:'library',confirmed:true,expectedRevision:current.contextRevision,entrance:'North entrance'});
  if(phase==='forget') current=await call({action:'forget',placeId:'library',confirmed:true,expectedRevision:current.contextRevision});
  console.log(JSON.stringify({pid:process.pid,entrance:current.entrance,revision:current.contextRevision}));
} finally {await app.close();}
