import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortlist } from '../src/selection.ts';
import { createSelectionApp } from '../src/selection-app.ts';

const now = Date.parse('2026-10-23T20:00:00Z');
const provider = (id = 'p1') => ({ id, displayName: 'Synthetic provider', vehicleType: 'SEDAN', serviceTypes: ['TAXI'],
  available: true, eligible: true, connected: true, lastSeenAt: new Date(now).toISOString() });
const input = () => ({ contractVersion: 'selection-1.0', snapshotAt: new Date(now).toISOString(), serviceType: 'TAXI', vehicleType: '', providers: [provider()] });
test('selection keeps explicit matching, fresh, eligible available providers; creates no execution', () => {
  const request = input(); request.providers = [provider('b'), provider('a')];
  const result = shortlist(request, now);
  assert.deepEqual(result.options.map(p => p.id), ['a', 'b']);
  assert.equal(result.execution, 'none'); assert.equal(result.activity.length, 4);
  assert.equal(result.ranking, 'deterministic_id_order');
});
test('selection excludes unavailable/ineligible/disconnected/stale/mismatched providers', () => {
  for (const patch of [{ available: false }, { eligible: false }, { connected: false },
    { lastSeenAt: new Date(now - 61000).toISOString() }, { serviceTypes: [] }, { serviceTypes: ['DELIVERY'] }]) {
    const request = input(); Object.assign(request.providers[0], patch);
    const result = shortlist(request, now); assert.equal(result.options.length, 0); assert.equal(result.suggestedId, null);
    assert.ok(result.exclusions[0].reasons.length);
  }
});
test('selection rejects stale snapshots, future observations, duplicate ids and unknown fields', () => {
  assert.throws(() => shortlist({ ...input(), snapshotAt: new Date(now - 31000).toISOString() }, now));
  assert.throws(() => shortlist({ ...input(), providers: [provider(), provider()] }, now));
  assert.throws(() => shortlist({ ...input(), owner: 'untrusted' }, now));
  const request = input(); request.providers[0].lastSeenAt = new Date(now + 6000).toISOString();
  assert.equal(shortlist(request, now).options.length, 0);
});
test('service and vehicle filters never expand to a wildcard', () => {
  const request = input(); request.serviceType = 'BUSINESS.PLUMBER'; request.providers[0].serviceTypes = ['BUSINESS'];
  assert.equal(shortlist(request, now).options.length, 0);
  assert.equal(shortlist({ ...input(), vehicleType: 'VAN' }, now).options.length, 0);
});
test('option expiry respects the oldest retained heartbeat', () => {
  const request = input(); request.providers[0].lastSeenAt = new Date(now - 55000).toISOString();
  assert.equal(shortlist(request, now).expiresAt, new Date(now + 5000).toISOString());
});
test('selection API authenticates independently and makes no sponsor request', async () => {
  const app = createSelectionApp('synthetic-selection-key-'.repeat(3), () => now);
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/v1/selection/shortlists', payload: input() })).statusCode, 401);
    const response = await app.inject({ method: 'POST', url: '/v1/selection/shortlists', payload: input(),
      headers: { authorization: `Bearer ${'synthetic-selection-key-'.repeat(3)}` } });
    assert.equal(response.statusCode, 200); assert.equal(response.json().options[0].id, 'p1');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal((await app.inject({ method: 'POST', url: '/v1/selection/shortlists',
      payload: { ...input(), providers: Array.from({ length: 101 }, (_, i) => provider(String(i))) },
      headers: { authorization: `Bearer ${'synthetic-selection-key-'.repeat(3)}` } })).statusCode, 400);
  } finally { await app.close(); }
});
