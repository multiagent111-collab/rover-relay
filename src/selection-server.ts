import { createSelectionApp } from './selection-app.ts';

const token = process.env.RELAY2_SELECTION_TOKEN || '';
const port = Number(process.env.RELAY2_SELECTION_PORT || 4193);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid selection port.');
const app = createSelectionApp(token);
await app.listen({ host: '127.0.0.1', port });
console.log(`Relay2 selection service listening on loopback port ${port}; execution disabled.`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => { await app.close(); process.exit(0); });
