import { resolve, basename } from 'node:path';
import { createRoverMemoryApp } from './rover-memory-app.ts';
import { assertPortAvailable } from './lifecycle.ts';

const port=Number(process.env.RELAY2_MEMORY_PORT || 4194);
const directory=process.env.RELAY2_MEMORY_DATA_DIR || '';
if(!Number.isInteger(port) || port<1 || port>65535 || !directory || basename(resolve(directory))!=='rover-memory-integration')
  throw Error('Configure a loopback port and dedicated rover-memory-integration data directory.');
await assertPortAvailable('127.0.0.1',port);
const app=createRoverMemoryApp({dataDir:directory,internalToken:process.env.RELAY2_MEMORY_INTERNAL_TOKEN || '',
  contextSecret:process.env.RELAY2_MEMORY_CONTEXT_SECRET || '',localControlToken:process.env.RELAY2_MEMORY_LOCAL_CONTROL_TOKEN});
try { await app.listen({host:'127.0.0.1',port}); }
catch {await app.close(); throw Error('Memory service could not listen.');}
console.log(`ROVER entrance memory ready on loopback ${port}; official H-MEM, execution disabled.`);
for(const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,async()=>{await app.close();process.exit(0);});
