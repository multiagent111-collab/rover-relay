import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { selectionSchema, shortlist } from './selection.ts';

/** Stateless optional server-to-server boundary; independent of sponsor services. */
export function createSelectionApp(token: string, clock = Date.now) {
  if (token.length < 32) throw Error('Selection service needs a separate token of at least 32 characters.');
  const app = Fastify({ logger: false, bodyLimit: 65536, requestTimeout: 5000 });
  app.get('/v1/health', async () => ({ status: 'ok', contractVersion: 'selection-1.0', execution: 'none' }));
  app.post('/v1/selection/shortlists', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const received = Buffer.from(request.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${token}`);
    if (received.length !== expected.length || !timingSafeEqual(received, expected))
      return reply.code(401).send({ error: 'unauthorized' });
    const parsed = selectionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_selection_request' });
    try { return shortlist(parsed.data, clock()); }
    catch { return reply.code(409).send({ error: 'selection_snapshot_rejected' }); }
  });
  return app;
}
