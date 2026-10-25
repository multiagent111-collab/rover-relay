import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { configuration } from "../src/config.ts";
import type { Mission } from "../src/types.ts";

// An actual loopback listener and HTTP client, with every other fetch denied.
const directory = await mkdtemp(join(tmpdir(), "relay-judge-http-"));
const originalFetch = globalThis.fetch;
let base = "",
  outboundAttempts = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!base || url.origin !== base) {
    outboundAttempts++;
    throw Error("Judge sample forbids external services");
  }
  return originalFetch(input, init);
};
let opened: Awaited<ReturnType<typeof createApp>> | undefined;
try {
  opened = await createApp({
    config: {
      ...configuration(),
      sample: true,
      demo: true,
      databaseUrl: "",
      dataDir: directory,
    },
  });
  base = await opened.app.listen({ host: "127.0.0.1", port: 0 });
  const request = async (path: string, payload?: unknown) => {
    const response = await fetch(base + path, {
      ...(payload
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }
        : {}),
      signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, body: await response.json() };
  };
  const health = await request("/v1/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.mode, "offline_sample");
  const page = await fetch(base + "/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<html/i);
  const input = {
    sku: "HDMI-USB-C",
    quantity: 2,
    destination: "auditorium",
    budgetCents: 3500,
    deadlineMinutes: 30,
  };
  const feasible = await request("/v1/missions", input);
  assert.equal(feasible.status, 201);
  const before = feasible.body as Mission;
  assert.equal(before.status, "awaiting_approval");
  assert.equal(
    before.receipt?.candidates.find((c) => c.id === before.receipt?.selectedId)
      ?.totalCents,
    3200,
  );
  const infeasible = await request("/v1/missions", {
    ...input,
    budgetCents: 3000,
  });
  assert.equal(infeasible.status, 201);
  assert.equal(infeasible.body.receipt.selectedId, null);
  const disruption = await request("/demo/disruptions", {
    type: "stock",
    supplierId: "supplier-a",
    stock: 0,
  });
  assert.equal(disruption.status, 200);
  const approval = await request(`/v1/missions/${before.id}/approve`, {
    version: before.receipt!.version,
    digest: before.receipt!.digest,
    idempotencyKey: "judge-stale-approval",
  });
  assert.equal(approval.status, 409);
  const after = (await request(`/v1/missions/${before.id}`)).body as Mission;
  assert.equal(after.receipt!.version, 2);
  assert.equal(
    after.receipt?.candidates.find((c) => c.id === after.receipt?.selectedId)
      ?.totalCents,
    3500,
  );
  assert.equal(after.taskId, null);
  assert.equal(outboundAttempts, 0);
  console.log(
    JSON.stringify({
      kind: "judge_http",
      capturedAt: new Date().toISOString(),
      result: "pass",
      mode: "offline_sample",
      data: "synthetic campus fixtures",
      inference: "deterministic sample generator",
      execution: "simulator; no task approved",
      externalFetchAttempts: outboundAttempts,
      transport: "actual loopback HTTP",
      feasible: { status: feasible.status, mission: before },
      infeasible,
      disruption: {
        staleApprovalStatus: approval.status,
        response: approval.body,
        after,
      },
    }),
  );
} finally {
  await opened?.app.close();
  globalThis.fetch = originalFetch;
  await rm(directory, { recursive: true, force: true });
}
