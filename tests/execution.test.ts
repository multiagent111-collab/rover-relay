import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.ts";
import { configuration } from "../src/config.ts";
import { RelayService } from "../src/service.ts";
import {
  HttpGatewayExecutor,
  gatewayBodyDigest,
} from "../src/adapters/http-executor.ts";
import { SimulatorExecutor } from "../src/adapters/simulator.ts";
import {
  executionIntentSchema,
  executionTaskSchema,
  executionEventSchema,
  parseExecutionIntent,
  authorizeExecutionIntent,
  validateNewExecutionIntent,
} from "../src/execution-contract.ts";
import { hash } from "../src/domain.ts";
import { executionState } from "../src/execution.ts";
import type { Mission, Task } from "../src/types.ts";
import { gatewayFixture } from "./helpers/gateway-fixture.ts";

const input = {
  sku: "HDMI-USB-C",
  quantity: 2,
  destination: "auditorium",
  budgetCents: 3500,
  deadlineMinutes: 30,
};
const stranger = { tenant: "other-tenant", user: "coordinator" };
async function fixture(backend: "simulator" | "http_gateway") {
  const directory = await mkdtemp(join(tmpdir(), "relay-execution-"));
  let now = Date.now();
  const opened = await createApp({
    config: {
      ...configuration(),
      sample: true,
      demo: true,
      databaseUrl: "",
      dataDir: directory,
    },
    clock: () => now,
  });
  const original = opened.service;
  const gateway =
    backend === "http_gateway"
      ? await gatewayFixture(original.store, () => now)
      : undefined;
  const adapter = () =>
    gateway
      ? new HttpGatewayExecutor(
          original.store,
          original.mode,
          { baseUrl: gateway.baseUrl, authorize: gateway.sign, timeoutMs: 500 },
          () => now,
        )
      : new SimulatorExecutor(original.store, original.mode, () => now);
  const service = () =>
    new RelayService(
      original.store,
      original.data,
      original.generator,
      original.memory,
      original.mode,
      60,
      () => now,
      adapter(),
    );
  const active = service();
  const create = async () => {
    const response = await opened.app.inject({
      method: "POST",
      url: "/v1/missions",
      payload: input,
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json<Mission>();
  };
  const approve = (
    mission: Mission,
    key = `execution-${mission.id}`,
    executor = active,
  ) =>
    executor.requestDispatch(
      mission.owner,
      mission.id,
      mission.receipt!.version,
      mission.receipt!.digest,
      key,
    );
  return {
    ...opened,
    service: active,
    restart: service,
    gateway,
    create,
    approve,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
    close: async () => {
      await gateway?.close();
      await opened.app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
const rejects = (fn: () => unknown, code: string) =>
  assert.rejects(
    async () => fn(),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === code,
  );

for (const backend of ["simulator", "http_gateway"] as const) {
  test(`${backend}: same trusted intent, separate amounts, scoped retries after expiry and one execution owner`, async () => {
    const f = await fixture(backend);
    try {
      const mission = await f.create(),
        before = hash((await f.service.store.read()).fixtures);
      await rejects(
        () =>
          f.service.requestDispatch(
            stranger,
            mission.id,
            mission.receipt!.version,
            mission.receipt!.digest,
            "owner-test-key",
          ),
        "not_found",
      );
      await rejects(
        () =>
          f.service.requestDispatch(
            mission.owner,
            mission.id,
            mission.receipt!.version,
            "0".repeat(64),
            "tamper-test-key",
          ),
        "stale_plan",
      );
      const task = await f.approve(mission),
        state = await f.service.store.read();
      const intent = parseExecutionIntent(state.executionIntents![task.id]);
      assert.equal(task.status, "dispatch_requested");
      assert.equal(task.execution!.backend, backend);
      assert.equal(intent.request.revision, 1);
      assert.ok(
        executionTaskSchema.safeParse(
          executionState(task, intent, task.createdAt),
        ).success,
      );
      assert.equal(intent.request.digest, hash(mission.request));
      assert.equal(intent.approvedPlan.digest, mission.receipt!.digest);
      assert.equal(intent.approvedPlan.version, 1);
      assert.deepEqual(intent.money, {
        currency: "USD",
        itemEstimateCents: 2400,
        deliveryEstimateCents: 800,
        explicitFeesCents: 0,
        approvedTotalCents: 3200,
      });
      assert.ok(intent.evidenceIds.length >= 3);
      assert.equal(intent.absoluteDeadlineAt, mission.deadlineAt);
      assert.equal(backend === "http_gateway", before === hash(state.fixtures));
      if (f.gateway) {
        assert.equal(f.gateway.jobs.size, 1);
        assert.equal(
          state.events.filter((e) => e.type.startsWith("simulated_")).length,
          0,
        );
      }
      f.advance(120000);
      const retry = await f.approve(mission, undefined, f.restart());
      assert.equal(retry.id, task.id);
      assert.equal(retry.execution!.intentId, intent.intentId);
      assert.equal(retry.execution!.jobId, task.execution!.jobId);
      await rejects(
        () => f.approve(mission, "another-approval-key"),
        "active_task",
      );
      await rejects(
        () =>
          f.service.requestDispatch(
            mission.owner,
            mission.id,
            2,
            mission.receipt!.digest,
            `execution-${mission.id}`,
          ),
        "idempotency_conflict",
      );
      assert.equal(Object.keys((await f.service.store.read()).tasks).length, 1);
      await rejects(() => f.service.cancelTask(stranger, task.id), "not_found");
      if (f.gateway)
        await rejects(
          () =>
            new SimulatorExecutor(
              f.service.store,
              f.service.mode,
              f.now,
            ).transition(mission.owner, task.id, "accepted"),
          "execution_backend_mismatch",
        );
      const cancelled = await f.service.cancelTask(
        mission.owner,
        task.id,
        task.revision,
      );
      if (f.gateway) {
        assert.equal(cancelled.status, "dispatch_requested");
        assert.equal(cancelled.cancellation!.confirmedAt, null);
        f.gateway.confirmCancellation();
        const confirmed = await f.service.getTask(mission.owner, task.id);
        assert.equal(confirmed.status, "cancelled");
        assert.ok(confirmed.cancellation!.confirmedAt);
      } else {
        assert.equal(cancelled.status, "cancelled");
        assert.ok(cancelled.cancellation!.confirmedAt);
      }
    } finally {
      await f.close();
    }
  });
}

test("HTTP gateway: committed response loss recovers one job/intent/outbox after adapter reconstruction", async () => {
  const f = await fixture("http_gateway");
  try {
    const mission = await f.create();
    f.gateway!.loseCreateResponse();
    await rejects(() => f.approve(mission), "dependency_unavailable");
    const state = await f.service.store.read(),
      task = Object.values(state.tasks)[0];
    assert.equal(task.status, "queued");
    assert.equal(state.outbox.filter((m) => !m.delivered).length, 1);
    assert.equal(f.gateway!.jobs.size, 1);
    const jobId = [...f.gateway!.jobs.values()][0].task.jobId;
    // A wrong executor cannot consume another adapter's queued outbox.
    await rejects(
      () =>
        new SimulatorExecutor(f.service.store, f.service.mode).drainOutbox(),
      "execution_backend_mismatch",
    );
    f.advance(120000);
    const recovered = await f.approve(mission, undefined, f.restart());
    assert.equal(recovered.id, task.id);
    assert.equal(recovered.execution!.jobId, jobId);
    await f.restart().drainOutbox();
    const final = await f.service.store.read();
    assert.equal(final.tasks[task.id].status, "dispatch_requested");
    assert.equal(f.gateway!.jobs.size, 1);
    assert.equal(final.outbox.length, 1);
    assert.ok(final.outbox[0].delivered);
    assert.equal(
      final.events.filter((e) => e.type === "gateway_state").length,
      1,
    );
    f.gateway!.loseCancelResponse();
    await rejects(
      () => f.service.cancelTask(mission.owner, task.id, recovered.revision),
      "dependency_unavailable",
    );
    assert.equal(
      (await f.service.store.read()).tasks[task.id].cancellation!.confirmedAt,
      null,
    );
    const pending = await f
      .restart()
      .cancelTask(mission.owner, task.id, recovered.revision);
    assert.equal(pending.status, "dispatch_requested");
    assert.equal(pending.cancellation!.confirmedAt, null);
    assert.equal(f.gateway!.jobs.size, 1);
    f.gateway!.confirmCancellation();
    const confirmed = await f.restart().getTask(mission.owner, task.id);
    assert.equal(confirmed.status, "cancelled");
    assert.ok(confirmed.cancellation!.confirmedAt);
  } finally {
    await f.close();
  }
});

test("HTTP gateway: signed identity plus trusted persisted approval rejects spoofing, tampered terms and incompatible versions", async () => {
  const f = await fixture("http_gateway");
  try {
    const mission = await f.create(),
      task = await f.approve(mission);
    const intent = (await f.service.store.read()).executionIntents![task.id];
    assert.equal((await f.gateway!.send(stranger, intent)).status, 409);
    assert.equal(
      (await f.gateway!.send(mission.owner, intent, "unsigned-identity"))
        .status,
      401,
    );
    const path = "/internal/relay/v1/execution-intents";
    const wrongBody = await f.gateway!.sign({
      identity: mission.owner,
      method: "POST",
      path,
      bodyDigest: gatewayBodyDigest("wrong body"),
    });
    assert.equal(
      (await f.gateway!.send(mission.owner, intent, wrongBody)).status,
      401,
    );
    const singleUse = await f.gateway!.sign({
      identity: mission.owner,
      method: "POST",
      path,
      bodyDigest: gatewayBodyDigest(JSON.stringify(intent)),
    });
    assert.equal(
      (await f.gateway!.send(mission.owner, intent, singleUse)).status,
      200,
    );
    assert.equal(
      (await f.gateway!.send(mission.owner, intent, singleUse)).status,
      401,
    );
    const mutations = [
      { ...intent, owner: mission.owner },
      { ...intent, contractVersion: "2.0" },
      { ...intent, contractVersion: "1.1" },
      {
        ...intent,
        approvedPlan: { version: 2, digest: hash("caller-computed") },
      },
      {
        ...intent,
        money: {
          ...intent.money,
          deliveryEstimateCents: 1,
          approvedTotalCents: 2401,
        },
      },
      { ...intent, selected: { ...intent.selected, courierId: "courier-2" } },
      { ...intent, pickup: { locationId: "unmapped-place" } },
      { ...intent, equipment: { sku: "OTHER", quantity: 2 } },
      { ...intent, money: { ...intent.money, approvedTotalCents: 0 } },
      {
        ...intent,
        evidenceIds: [intent.evidenceIds[0], intent.evidenceIds[0]],
      },
    ];
    for (const value of mutations) {
      const response = await f.gateway!.send(mission.owner, value);
      assert.ok([400, 409].includes(response.status), await response.text());
    }
    assert.equal(f.gateway!.jobs.size, 1);
    assert.throws(() =>
      authorizeExecutionIntent(mission.owner, intent, undefined),
    );
    assert.throws(() =>
      validateNewExecutionIntent(intent, Date.parse(intent.expiresAt)),
    );
    f.advance(120000);
    assert.equal(
      (await f.gateway!.send(mission.owner, intent)).status,
      200,
      "exact committed retry survives expiry",
    );
  } finally {
    await f.close();
  }
});

test("HTTP gateway: parallel approvals and provider contention cannot produce simulator side effects or duplicate jobs", async () => {
  const f = await fixture("http_gateway");
  try {
    const mission = await f.create(),
      other = await f.create(),
      fixtures = hash((await f.service.store.read()).fixtures);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => f.approve(mission)),
    );
    assert.equal(new Set(results.map((t) => t.id)).size, 1);
    assert.equal(f.gateway!.jobs.size, 1);
    await rejects(() => f.approve(other), "provider_unavailable");
    assert.equal(hash((await f.service.store.read()).fixtures), fixtures);
    await rejects(
      () => f.service.transition(mission.owner, results[0].id, "accepted"),
      "execution_not_simulated",
    );
  } finally {
    await f.close();
  }
});

test("HTTP gateway: incompatible/misbinding responses and stale revisions fail closed; no synthetic fallback", async () => {
  const f = await fixture("http_gateway");
  try {
    const mission = await f.create(),
      task = await f.approve(mission);
    for (const mutation of [
      (t: unknown) => ({ ...(t as object), contractVersion: "9.0" }),
      (t: unknown) => ({ ...(t as object), taskId: randomUUID() }),
      (t: unknown) => ({
        ...(t as object),
        selected: { supplierId: "supplier-b", courierId: "courier-2" },
      }),
      (t: unknown) => ({ ...(t as object), jobId: randomUUID() }),
      (t: unknown) => ({ ...(t as object), status: "accepted" }),
    ]) {
      f.gateway!.mutateResponse(mutation);
      await assert.rejects(() => f.service.getTask(mission.owner, task.id));
      assert.equal(
        (await f.service.store.read()).tasks[task.id].status,
        "dispatch_requested",
      );
    }
    f.gateway!.mutateResponse();
    await rejects(
      () => f.service.cancelTask(mission.owner, task.id, 0),
      "stale_task_revision",
    );
    assert.equal(
      (await f.service.store.read()).events.filter((e) =>
        e.type.startsWith("simulated_"),
      ).length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("HTTP gateway: an actual bounded timeout after commit retries the same job", async () => {
  const f = await fixture("http_gateway");
  try {
    const mission = await f.create();
    f.gateway!.timeoutCreateResponse();
    const started = performance.now();
    await rejects(() => f.approve(mission), "dependency_unavailable");
    assert.ok(
      performance.now() - started >= 400,
      "request reached its 500ms fixture timeout",
    );
    const state = await f.service.store.read(),
      task = Object.values(state.tasks)[0];
    const recovered = await f.approve(mission, undefined, f.restart());
    assert.equal(recovered.id, task.id);
    assert.equal(f.gateway!.jobs.size, 1);
    assert.equal(
      recovered.execution!.jobId,
      [...f.gateway!.jobs.values()][0].task.jobId,
    );
  } finally {
    await f.close();
  }
});

test("HTTP gateway: definitive quote/provider conflicts require a fresh plan and approval, without substitution", async () => {
  for (const code of ["quote_changed", "provider_unavailable"] as const) {
    const f = await fixture("http_gateway");
    try {
      const mission = await f.create();
      f.gateway!.rejectNextIntent(code);
      await rejects(() => f.approve(mission), code);
      const state = await f.service.store.read(),
        task = Object.values(state.tasks)[0];
      assert.equal(task.status, "declined");
      assert.equal(task.execution!.rejectionCode, code);
      assert.equal(f.gateway!.jobs.size, 0);
      assert.equal(state.outbox.filter((m) => !m.delivered).length, 0);
      await rejects(
        () => f.approve(mission, "unreviewed-retry-key"),
        "invalid_state",
      );
      const replacement = await f.service.plan(
        mission.owner,
        mission.id,
        "Gateway rejected terms; review a new proposal.",
      );
      assert.equal(replacement.receipt!.version, 2);
      assert.equal(f.gateway!.jobs.size, 0);
      const approved = await f.approve(replacement, "fresh-reviewed-approval");
      assert.notEqual(approved.id, task.id);
      assert.equal(f.gateway!.jobs.size, 1);
    } finally {
      await f.close();
    }
  }
});

test("execution 1.0 schemas are strict and explicit; unknown/minor versions require reviewed migration", async () => {
  const f = await fixture("simulator");
  try {
    const mission = await f.create(),
      task = await f.approve(mission),
      intent = (await f.service.store.read()).executionIntents![task.id];
    assert.ok(executionIntentSchema.safeParse(intent).success);
    assert.throws(() =>
      parseExecutionIntent({ ...intent, contractVersion: "1.1" }),
    );
    assert.throws(() =>
      parseExecutionIntent({ ...intent, expiresAt: intent.approvedAt }),
    );
    assert.throws(() =>
      parseExecutionIntent({
        ...intent,
        absoluteDeadlineAt: intent.approvedAt,
      }),
    );
    assert.throws(() =>
      parseExecutionIntent({
        ...intent,
        money: { ...intent.money, deliveryEstimateCents: 1.5 },
      }),
    );
    assert.equal(executionTaskSchema.safeParse({}).success, false);
    assert.equal(executionEventSchema.safeParse({}).success, false);
  } finally {
    await f.close();
  }
});
