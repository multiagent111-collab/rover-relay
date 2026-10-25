import {resolve} from 'node:path';
import {createApp} from '../src/app.ts';
import {assertPortAvailable} from '../src/lifecycle.ts';
// Explicit sample configuration: never load the live workstation .env.
const port=Number(process.env.RELAY_JUDGE_PORT || 4199);
if(!Number.isInteger(port) || port<1024 || port>65535)throw Error('Invalid local judging port');
await assertPortAvailable('127.0.0.1',port);
const opened=await createApp({config:{sample:true,demo:true,host:'127.0.0.1',port,
    dataDir:resolve(process.env.RELAY_JUDGE_DATA_DIR || '.data/judge-local'),databaseUrl:'',accessToken:'',planTtlSeconds:120}});
try {await opened.app.listen({host:'127.0.0.1',port});} catch(e) {await opened.app.close();throw e;}
console.log(JSON.stringify({mode:'OFFLINE SAMPLE',execution:'simulated',memory:'official Meterless H-MEM',port}));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{await opened.app.close();process.exit(0);});
