import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { SqliteStore } from "../src/store.ts";
import { MemoryAdapter } from "../src/memory.ts";
import { configuration } from "../src/config.ts";
import { normalizeRuntimeUrl } from "../src/agents.ts";
import type { Mission, Task } from "../src/types.ts";

const input = {
  sku: "HDMI-USB-C",
  quantity: 2,
  destination: "auditorium",
  budgetCents: 3500,
  deadlineMinutes: 30,
};
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "relay-test-"));
  let now = Date.parse("2026-10-20T20:00:00Z");
  const config = {
    ...configuration(),
    sample: true,
    demo: true,
    databaseUrl: "",
    dataDir: directory,
  };
  const opened = await createApp({ config, clock: () => now });
  const app = opened.app;
  const create = async (body: unknown = input) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/missions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(body),
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json<Mission>();
  };
  const approve = (mission: Mission, key = `approve-${mission.id}`) =>
    app.inject({
      method: "POST",
      url: `/v1/missions/${mission.id}/approve`,
      payload: {
        version: mission.receipt!.version,
        digest: mission.receipt!.digest,
        idempotencyKey: key,
      },
    });
  return {
    ...opened,
    directory,
    config,
    create,
    approve,
    advance: (ms: number) => {
      now += ms;
    },
    dispose: async () => {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("normal request produces a checked receipt and exactly one task on duplicate approval", async () => {
  const f = await fixture();
  try {
    const mission = await f.create();
    assert.equal(mission.status, "awaiting_approval");
    const selected = mission.receipt!.candidates.find(
      (candidate) => candidate.id === mission.receipt!.selectedId,
    )!;
    assert.equal(selected.totalCents, 3200);
    assert.equal(selected.travelMinutes, 22);
    assert.equal(
      selected.checks.every((check) => check.passed),
      true,
    );
    const approvals = await Promise.all([
      f.approve(mission),
      f.approve(mission),
    ]);
    for (const response of approvals)
      assert.equal(response.statusCode, 200, response.body);
    assert.equal(approvals[0].json<Task>().id, approvals[1].json<Task>().id);
    const state = await f.service.store.read();
    assert.equal(Object.keys(state.tasks).length, 1);
    assert.equal(
      state.events.filter((event) => event.type === "simulated_offer_sent")
        .length,
      1,
    );
    assert.equal(
      state.outbox.every((message) => message.delivered),
      true,
    );
  } finally {
    await f.dispose();
  }
});

test("stock change rejects the old approval and creates a critiqued replacement", async () => {
  const f = await fixture();
  try {
    const mission = await f.create();
    await f.app.inject({
      method: "POST",
      url: "/demo/disruptions",
      payload: { type: "stock", supplierId: "supplier-a", stock: 0 },
    });
    const response = await f.approve(mission);
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "plan_replaced");
    const revised = await f.service.get(mission.owner, mission.id);
    assert.equal(revised.receipt!.version, 2);
    assert.equal(revised.receipt!.selectedId, "supplier-b:courier-2");
    assert.ok(
      revised.receipt!.steps.some(
        (step) => step.role === "Critic" && step.decision === "revise_proposal",
      ),
    );
    assert.ok(
      revised.receipt!.steps.some(
        (step) => step.role === "Planner" && step.round === 2,
      ),
    );
    assert.equal(Object.keys((await f.service.store.read()).tasks).length, 0);
  } finally {
    await f.dispose();
  }
});

test("expired proposal cannot dispatch and absolute mission deadline is preserved", async () => {
  const f = await fixture();
  try {
    const mission = await f.create();
    f.advance(61000);
    const response = await f.approve(mission);
    assert.equal(response.statusCode, 409);
    const revised = await f.service.get(mission.owner, mission.id);
    assert.equal(revised.deadlineAt, mission.deadlineAt);
    assert.equal(revised.receipt!.version, 2);
  } finally {
    await f.dispose();
  }
});

test("tight budget returns the computed $2 minimum change without creating a task", async () => {
  const f = await fixture();
  try {
    const mission = await f.create({ ...input, budgetCents: 3000 });
    assert.equal(mission.status, "infeasible");
    assert.equal(mission.receipt!.selectedId, null);
    assert.equal(mission.receipt!.alternatives.budgetIncreaseCents, 200);
    assert.equal(mission.receipt!.alternatives.deadlineExtensionMinutes, null);
    assert.equal((await f.approve(mission)).statusCode, 409);
  } finally {
    await f.dispose();
  }
});

test("route closure changes the computed path and invalidates approval", async () => {
  const f = await fixture();
  try {
    const mission = await f.create();
    await f.app.inject({
      method: "POST",
      url: "/demo/disruptions",
      payload: { type: "route", edgeId: "E4", closed: true },
    });
    assert.equal((await f.approve(mission)).statusCode, 409);
    const current = await f.service.get(mission.owner, mission.id);
    const chosen = current.receipt!.candidates.find(
      (candidate) => candidate.id === current.receipt!.selectedId,
    )!;
    assert.equal(chosen.id, "supplier-b:courier-2");
    assert.ok(!chosen.routeEdges.includes("E4"));
  } finally {
    await f.dispose();
  }
});

test("confirmed H-MEM preference survives reload, is injected, changes approval, and can be forgotten", async () => {
  const f = await fixture();
  const identity = { tenant: "relay-demo", user: "coordinator" };
  try {
    f.service.memory.set(identity, "auditorium", "North loading entrance");
    const reloaded = new MemoryAdapter(join(f.directory, "hmem"));
    assert.equal(
      reloaded.recall(identity, "auditorium").entrance,
      "North loading entrance",
    );
    const mission = await f.create();
    assert.match(mission.receipt!.memory.context, /North loading entrance/);
    assert.ok(
      mission
        .receipt!.steps.filter((step) => step.role !== "Validator")
        .every((step) => step.memoryIds.length === 1),
    );
    f.service.memory.set(identity, "auditorium", "South stage door");
    assert.equal((await f.approve(mission)).statusCode, 409);
    const current = await f.service.get(identity, mission.id);
    assert.equal(current.receipt!.memory.entrance, "South stage door");
    assert.ok(
      !current.receipt!.memory.context.includes("North loading entrance"),
    );
    f.service.memory.forget(identity, "auditorium");
    assert.equal(
      new MemoryAdapter(join(f.directory, "hmem")).recall(
        identity,
        "auditorium",
      ).records.length,
      0,
    );
  } finally {
    await f.dispose();
  }
});

test("another demo identity cannot read missions, approve plans, or recall preferences", async () => {
  const f = await fixture();
  try {
    const mission = await f.create();
    f.service.memory.set(mission.owner, "auditorium", "Private entrance");
    const headers = { "x-relay-demo-user": "reviewer" };
    assert.equal(
      (await f.app.inject({ url: `/v1/missions/${mission.id}`, headers }))
        .statusCode,
      404,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/missions/${mission.id}/approve`,
          headers,
          payload: {
            version: 1,
            digest: mission.receipt!.digest,
            idempotencyKey: "reviewer-key",
          },
        })
      ).statusCode,
      404,
    );
    const data = (await f.app.inject({ url: "/v1/bootstrap", headers })).json();
    assert.equal(data.missions.length, 0);
    assert.equal(data.preferences.records.length, 0);
    assert.equal(
      (
        await f.app.inject({
          url: "/v1/bootstrap",
          headers: { "x-relay-demo-user": "unrecognized" },
        })
      ).statusCode,
      401,
    );
  } finally {
    await f.dispose();
  }
});

test("courier decline releases the task and proposes an alternative requiring new approval", async () => {
  const f = await fixture();
  try {
    const mission = await f.create();
    const task = (await f.approve(mission)).json<Task>();
    const response = await f.app.inject({
      method: "POST",
      url: `/demo/tasks/${task.id}/response`,
      payload: { status: "declined" },
    });
    assert.equal(response.statusCode, 200, response.body);
    const current = await f.service.get(mission.owner, mission.id);
    assert.equal(current.status, "awaiting_approval");
    assert.equal(current.receipt!.selectedId, "supplier-b:courier-2");
    assert.equal(current.receipt!.version, 2);
    assert.equal(
      (await f.approve(current, "approve-replacement")).statusCode,
      200,
    );
  } finally {
    await f.dispose();
  }
});

test("task progresses through acceptance and delivery and invalid transitions are rejected", async () => {
  const f = await fixture();
  try {
    const mission = await f.create();
    const task = (await f.approve(mission)).json<Task>();
    const endpoint = `/demo/tasks/${task.id}/response`;
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: endpoint,
          payload: { status: "completed" },
        })
      ).statusCode,
      409,
    );
    for (const status of ["accepted", "in_progress", "completed"]) {
      const response = await f.app.inject({
        method: "POST",
        url: endpoint,
        payload: { status },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().status, status);
    }
    assert.equal(
      (await f.service.get(mission.owner, mission.id)).status,
      "completed",
    );
    assert.ok(
      (await f.service.store.read()).fixtures.couriers.find(
        (courier) => courier.id === task.courierId,
      )!.available,
    );
  } finally {
    await f.dispose();
  }
});

test("different approval payload cannot reuse the same idempotency key", async () => {
  const f = await fixture();
  try {
    const one = await f.create();
    await f.approve(one, "fixed-approval-key");
    const two = await f.create();
    const response = await f.approve(two, "fixed-approval-key");
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "idempotency_conflict");
  } finally {
    await f.dispose();
  }
});

test("pending outbox delivery recovers after a database reopen without duplicating the task", async () => {
  const f = await fixture();
  try {
    const mission = await f.create();
    const drain = f.service.drainOutbox.bind(f.service);
    f.service.drainOutbox = async () => {};
    const task = (await f.approve(mission)).json<Task>();
    assert.equal(task.status, "queued");
    // Recovery reopens a closed writer; concurrent writers must be refused.
    await f.app.close();
    const reopened = new SqliteStore(join(f.directory, "relay.sqlite"));
    const recovered = await createApp({ config: f.config, store: reopened });
    try {
      assert.equal(
        (await recovered.service.getTask(mission.owner, task.id)).status,
        "dispatch_requested",
      );
      await recovered.service.drainOutbox();
      assert.equal(
        (await reopened.read()).events.filter(
          (event) => event.type === "simulated_offer_sent",
        ).length,
        1,
      );
    } finally {
      await recovered.app.close();
    }
    f.service.drainOutbox = drain;
  } finally {
    await f.dispose();
  }
});

test("sample execution makes no outbound fetch calls", async () => {
  const f = await fixture();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("Unexpected outbound network call");
    };
    const mission = await f.create();
    assert.equal((await f.approve(mission)).statusCode, 200);
  } finally {
    globalThis.fetch = original;
    await f.dispose();
  }
});

test("negative, fractional, and extra request fields are rejected at the boundary", async () => {
  const f = await fixture();
  try {
    for (const invalid of [
      { ...input, quantity: -1 },
      { ...input, budgetCents: 0.5 },
      { ...input, owner: "someone-else" },
    ])
      assert.equal(
        (
          await f.app.inject({
            method: "POST",
            url: "/v1/missions",
            payload: invalid,
          })
        ).statusCode,
        400,
      );
    assert.equal(
      Object.keys((await f.service.store.read()).missions).length,
      0,
    );
  } finally {
    await f.dispose();
  }
});

test("unavailable dependencies produce controlled failure and never create a task", async () => {
  const f = await fixture();
  try {
    f.service.generator.generate = async () => {
      throw new Error("Do not expose raw provider information");
    };
    const response = await f.app.inject({
      method: "POST",
      url: "/v1/missions",
      payload: input,
    });
    assert.equal(response.statusCode, 503);
    assert.ok(!response.body.includes("raw provider"));
    const state = await f.service.store.read();
    assert.equal(Object.keys(state.tasks).length, 0);
    assert.equal(
      Object.values(state.missions)[0].status,
      "dependency_unavailable",
    );
  } finally {
    await f.dispose();
  }
});

test("schema-invalid proposals exhaust a bounded loop and cannot dispatch", async () => {
  const f = await fixture();
  let calls = 0;
  try {
    f.service.generator.generate = async () => {
      calls++;
      return {
        provider: "test",
        model: "malformed",
        value: { candidateId: "made-up" },
      };
    };
    const response = await f.app.inject({
      method: "POST",
      url: "/v1/missions",
      payload: input,
    });
    assert.equal(response.statusCode, 503);
    assert.equal(calls, 2);
    assert.equal(Object.keys((await f.service.store.read()).tasks).length, 0);
  } finally {
    await f.dispose();
  }
});

test("evidence export is ordered, machine-readable, and identifies the actual mode", async () => {
  const f = await fixture();
  try {
    const mission = await f.create();
    await f.approve(mission);
    const response = await f.app.inject({
      url: `/v1/missions/${mission.id}/evidence.jsonl`,
    });
    const events = response.body
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(events.length > 5);
    assert.ok(
      events.every(
        (event, index) =>
          event.sequence === index + 1 && event.mode === "offline_sample",
      ),
    );
    assert.ok(events.some((event) => event.type === "memory_retrieved"));
  } finally {
    await f.dispose();
  }
});

test("Runtime URL normalization never duplicates /v1", () => {
  for (const suffix of [
    "",
    "/v1",
    "/v1/models",
    "/v1/chat/completions",
    "/healthz",
  ])
    assert.equal(
      normalizeRuntimeUrl("127.0.0.1:8088" + suffix),
      "http://127.0.0.1:8088/v1",
    );
  assert.throws(() =>
    normalizeRuntimeUrl("http://user:password@localhost:8088"),
  );
});
