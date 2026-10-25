import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { configuration } from "../src/config.ts";
import { alternatives, enumerateCandidates, hash } from "../src/domain.ts";
import { seedFixtures } from "../src/fixtures.ts";
import { sampleEvidence } from "../src/evidence.ts";
import type { Mission, Task } from "../src/types.ts";

const input = {
  sku: "HDMI-USB-C",
  quantity: 2,
  destination: "auditorium",
  budgetCents: 3500,
  deadlineMinutes: 30,
};
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "relay-lifecycle-"));
  let now = Date.parse("2026-10-22T23:00:00Z");
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
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("Lifecycle sample attempted external fetch");
  };
  const call = (url: string, payload?: unknown, reviewer = false) =>
    opened.app.inject({
      method: payload === undefined ? "GET" : "POST",
      url,
      payload: payload as never,
      headers: reviewer ? { "x-relay-demo-user": "reviewer" } : {},
    });
  const create = async (request = input) => {
    const response = await call("/v1/missions", request);
    assert.equal(response.statusCode, 201, response.body);
    return response.json<Mission>();
  };
  const approve = (
    mission: Mission,
    key = `lifecycle-${mission.id}-${mission.receipt!.version}`,
  ) =>
    call(`/v1/missions/${mission.id}/approve`, {
      version: mission.receipt!.version,
      digest: mission.receipt!.digest,
      idempotencyKey: key,
    });
  const get = (mission: Mission) =>
    opened.service.get(mission.owner, mission.id);
  const response = (task: Task, status: string, expectedRevision?: number) =>
    call(`/demo/tasks/${task.id}/response`, {
      status,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    });
  return {
    ...opened,
    create,
    approve,
    call,
    get,
    response,
    advance: (ms: number) => {
      now += ms;
    },
    close: async () => {
      globalThis.fetch = originalFetch;
      await opened.app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("stock, named edge and entrance changes produce structured replacement receipts that need fresh approval", async () => {
  for (const kind of ["stock", "route", "entrance"] as const) {
    const f = await fixture();
    try {
      const mission = await f.create(),
        original = structuredClone(mission.receipt!);
      if (kind === "entrance")
        f.service.memory.set(
          mission.owner,
          "auditorium",
          "New confirmed test stage door",
        );
      else
        assert.equal(
          (
            await f.call(
              "/demo/disruptions",
              kind === "stock"
                ? { type: "stock", supplierId: "supplier-a", stock: 0 }
                : { type: "route", edgeId: "E4", closed: true },
            )
          ).statusCode,
          200,
        );
      const rejected = await f.approve(mission);
      assert.equal(rejected.statusCode, 409);
      assert.equal(rejected.json().error, "plan_replaced");
      const current = await f.get(mission),
        details = current.receipt!.changeDetails!;
      assert.equal(current.status, "awaiting_approval");
      assert.equal(current.receipt!.version, 2);
      assert.equal(details.schemaVersion, "change-1.0");
      assert.equal(details.confirmationRequired, true);
      assert.ok(
        details.reasons.includes(
          kind === "entrance"
            ? "entrance_changed"
            : kind === "route"
              ? "route_changed"
              : "stock_changed",
        ),
      );
      assert.equal(details.previous.digest, original.digest);
      assert.equal(details.current.version, 2);
      assert.equal(details.originalDeadlineAt, mission.deadlineAt);
      assert.equal(current.deadlineAt, mission.deadlineAt);
      assert.deepEqual(current.request, mission.request);
      assert.deepEqual(mission.receipt, original);
      if (kind === "stock") {
        const delta = details.sourceChanges.find(
          (c) => c.recordId === "supplier-a",
        )!;
        assert.equal(delta.before!.stock, 6);
        assert.equal(delta.after!.stock, 0);
      }
      if (kind === "route") {
        const delta = details.sourceChanges.find((c) => c.recordId === "E4")!;
        assert.equal(delta.before!.closed, false);
        assert.equal(delta.after!.closed, true);
        assert.ok(!details.current.terms!.routeEdges.includes("E4"));
      }
      if (kind === "entrance")
        assert.equal(
          details.current.terms!.entrance,
          "New confirmed test stage door",
        );
      assert.equal(Object.keys((await f.service.store.read()).tasks).length, 0);
      assert.equal(
        (await f.approve(mission, "stale-different-key")).statusCode,
        409,
      );
      const taskResponse = await f.approve(current);
      assert.equal(taskResponse.statusCode, 200, taskResponse.body);
      assert.equal(
        taskResponse.json<Task>().planDigest,
        current.receipt!.digest,
      );
      console.log(
        JSON.stringify({
          proof: "change_receipt",
          scenario: kind,
          missionId: mission.id,
          oldApprovalStatus: rejected.statusCode,
          originalDigest: original.digest,
          replacementDigest: current.receipt!.digest,
          approvedTaskId: taskResponse.json<Task>().id,
          change: details,
        }),
      );
    } finally {
      await f.close();
    }
  }
});
test("material price, ETA and courier changes never execute the old terms", async () => {
  for (const kind of ["price", "eta", "courier"] as const) {
    const f = await fixture();
    try {
      const mission = await f.create();
      await f.service.store.transact((state) => {
        if (kind === "price") {
          state.fixtures.suppliers[0].unitPriceCents += 50;
          state.fixtures.suppliers[0].version++;
        }
        if (kind === "eta") {
          state.fixtures.edges.find((e) => e.id === "E4")!.minutes++;
        }
        if (kind === "courier") {
          state.fixtures.couriers[0].available = false;
          state.fixtures.couriers[0].version++;
        }
        state.fixtures.revision++;
      });
      assert.equal((await f.approve(mission)).statusCode, 409);
      const current = await f.get(mission),
        details = current.receipt!.changeDetails!;
      assert.ok(
        details.reasons.includes(
          kind === "price"
            ? "price_changed"
            : kind === "eta"
              ? "eta_changed"
              : "courier_changed",
        ),
      );
      assert.equal(Object.keys((await f.service.store.read()).tasks).length, 0);
      assert.notDeepEqual(details.previous.terms, details.current.terms);
      assert.equal(current.deadlineAt, mission.deadlineAt);
    } finally {
      await f.close();
    }
  }
});
test("a decline releases the slot, excludes that courier only for this mission, and duplicate or old events cannot replan again", async () => {
  const f = await fixture();
  try {
    const mission = await f.create(),
      task = (await f.approve(mission)).json<Task>();
    const generator = f.service.generator.generate.bind(f.service.generator);
    let calls = 0;
    f.service.generator.generate = async (...args) => {
      calls++;
      return generator(...args);
    };
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        f.response(task, "declined", task.revision),
      ),
    );
    responses.forEach((r) => assert.equal(r.statusCode, 200, r.body));
    const current = await f.get(mission),
      state = await f.service.store.read();
    assert.equal(current.receipt!.version, 2);
    assert.equal(current.status, "awaiting_approval");
    assert.equal(
      calls,
      current.receipt!.steps.filter((step) => step.role !== "Validator").length,
    );
    assert.ok(calls <= 4, "Only one bounded planning/repair run is allowed");
    assert.equal(Object.keys(state.tasks).length, 1);
    assert.equal(
      state.fixtures.couriers.find((c) => c.id === task.courierId)!.available,
      true,
    );
    assert.equal(
      state.events.filter((e) => e.type === "simulated_declined").length,
      1,
    );
    assert.ok(
      current.receipt!.changeDetails!.reasons.includes("courier_declined"),
    );
    const declined = current.receipt!.candidates.find(
      (c) => c.courier.id === task.courierId,
    )!;
    assert.equal(declined.feasible, false);
    assert.equal(
      declined.checks.find((c) => c.code === "prior_decline")!.passed,
      false,
    );
    assert.notEqual(current.receipt!.selectedId, mission.receipt!.selectedId);
    assert.equal(
      (await f.approve(mission, "old-plan-new-key")).statusCode,
      409,
    );
    assert.equal((await f.approve(mission)).json<Task>().id, task.id);
    const otherMission = await f.create();
    assert.equal(otherMission.receipt!.selectedId, mission.receipt!.selectedId);
    const replacement = (await f.approve(current)).json<Task>();
    assert.notEqual(replacement.id, task.id);
    const beforeOld = await f.get(mission),
      callCount = calls;
    assert.equal((await f.response(task, "declined")).statusCode, 200);
    assert.equal((await f.response(task, "accepted")).statusCode, 409);
    assert.deepEqual(await f.get(mission), beforeOld);
    assert.equal(calls, callCount);
    console.log(
      JSON.stringify({
        proof: "decline",
        missionId: mission.id,
        declinedTaskId: task.id,
        replacementTaskId: replacement.id,
        replacementPlanVersion: current.receipt!.version,
        releasedCourierId: task.courierId,
        releasedCourierAvailable: state.fixtures.couriers.find(
          (c) => c.id === task.courierId,
        )!.available,
        duplicateResponses: responses.length,
        duplicateAddedPlanningCalls: calls - callCount,
        declineEvents: state.events.filter(
          (e) => e.type === "simulated_declined",
        ).length,
        originalDeadlineAt: mission.deadlineAt,
        reasons: current.receipt!.changeDetails!.reasons,
      }),
    );
    assert.equal(
      (await f.service.store.read()).tasks[replacement.id].status,
      "dispatch_requested",
    );
  } finally {
    await f.close();
  }
});
test("cancellation confirms only local simulation, releases once at every active stage, and stale outbox or old cancel cannot resurrect tasks", async () => {
  for (const stage of [
    "queued",
    "dispatch_requested",
    "accepted",
    "in_progress",
  ]) {
    const f = await fixture();
    try {
      const mission = await f.create(),
        drain = f.service.drainOutbox.bind(f.service);
      if (stage === "queued") f.service.drainOutbox = async () => {};
      let task = (await f.approve(mission)).json<Task>();
      if (["accepted", "in_progress"].includes(stage))
        task = (await f.response(task, "accepted")).json<Task>();
      if (stage === "in_progress")
        task = (await f.response(task, "in_progress")).json<Task>();
      const stateBefore = await f.service.store.read(),
        courierBefore = stateBefore.fixtures.couriers.find(
          (c) => c.id === task.courierId,
        )!;
      const cancelled = await f.call(`/v1/tasks/${task.id}/cancel`, {
        expectedRevision: task.revision,
      });
      assert.equal(cancelled.statusCode, 200, cancelled.body);
      const final = cancelled.json<Task>();
      assert.equal(final.status, "cancelled");
      assert.equal(final.cancellation!.backend, "simulator");
      assert.equal(
        final.cancellation!.requestedAt,
        final.cancellation!.confirmedAt,
      );
      const state = await f.service.store.read(),
        courier = state.fixtures.couriers.find((c) => c.id === task.courierId)!;
      assert.equal(courier.available, true);
      assert.equal(courier.version, courierBefore.version + 1);
      const events = state.events.filter(
        (e) =>
          e.data.taskId === task.id &&
          ["cancellation_requested", "simulated_cancelled"].includes(e.type),
      );
      assert.deepEqual(
        events.map((e) => e.type),
        ["cancellation_requested", "simulated_cancelled"],
      );
      assert.equal(
        (
          await f.call(`/v1/tasks/${task.id}/cancel`, {
            expectedRevision: task.revision,
          })
        ).statusCode,
        200,
      );
      assert.deepEqual(await f.service.store.read(), state);
      f.service.drainOutbox = drain;
      await drain();
      await drain();
      assert.equal(
        (await f.service.store.read()).events.filter(
          (e) => e.type === "simulated_offer_sent",
        ).length,
        stage === "queued" ? 0 : 1,
      );
      assert.equal((await f.response(task, "accepted")).statusCode, 409);
      const replanned = (
        await f.call(`/v1/missions/${mission.id}/replan`, {})
      ).json<Mission>();
      assert.equal(replanned.deadlineAt, mission.deadlineAt);
      assert.ok(
        replanned.receipt!.changeDetails!.reasons.includes("task_cancelled"),
      );
      const replacement = (await f.approve(replanned)).json<Task>();
      assert.notEqual(replacement.id, task.id);
      const beforeDuplicate = await f.service.store.read();
      assert.equal(
        (await f.call(`/v1/tasks/${task.id}/cancel`, {})).statusCode,
        200,
      );
      assert.deepEqual(await f.service.store.read(), beforeDuplicate);
      assert.equal(
        beforeDuplicate.fixtures.couriers.find(
          (c) => c.id === replacement.courierId,
        )!.available,
        false,
      );
      console.log(
        JSON.stringify({
          proof: "cancellation",
          stage,
          taskId: task.id,
          replacementTaskId: replacement.id,
          cancellation: final.cancellation,
          events: events.map((e) => ({
            id: e.id,
            type: e.type,
            sequence: e.sequence,
          })),
          pendingOfferSent: stage === "queued" ? 0 : 1,
          duplicateChangedState: false,
        }),
      );
    } finally {
      await f.close();
    }
  }
});
test("revisions and allowed transitions reject stale/out-of-order responses, while duplicates and legacy tasks remain safe", async () => {
  const f = await fixture();
  try {
    const mission = await f.create();
    let task = (await f.approve(mission)).json<Task>();
    assert.equal((await f.response(task, "completed")).statusCode, 409);
    assert.equal(
      (await f.response(task, "accepted", task.revision! - 1)).json().error,
      "stale_task_revision",
    );
    const oldRevision = task.revision;
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      f.service.transition(
        mission.owner,
        task.id,
        "accepted",
        controller.signal,
      ),
      (error: { code?: string }) => error.code === "operation_cancelled",
    );
    task = (await f.response(task, "accepted", task.revision)).json<Task>();
    const accepted = await f.service.store.read();
    assert.equal(
      (await f.response(task, "accepted", oldRevision)).statusCode,
      200,
    );
    assert.deepEqual(await f.service.store.read(), accepted);
    assert.equal(
      (await f.response(task, "in_progress", oldRevision)).statusCode,
      409,
    );
    task = (await f.response(task, "in_progress", task.revision)).json<Task>();
    assert.equal((await f.response(task, "accepted")).statusCode, 409);
    task = (await f.response(task, "completed", task.revision)).json<Task>();
    const completed = await f.service.store.read();
    assert.equal((await f.response(task, "completed")).statusCode, 200);
    assert.equal((await f.response(task, "declined")).statusCode, 409);
    assert.equal(
      (await f.call(`/v1/tasks/${task.id}/cancel`, {})).statusCode,
      409,
    );
    assert.deepEqual(await f.service.store.read(), completed);
    const another = await f.create(),
      legacy = (await f.approve(another)).json<Task>();
    await f.service.store.transact((state) => {
      delete state.tasks[legacy.id].revision;
    });
    assert.equal((await f.response(legacy, "accepted", 0)).statusCode, 200);
  } finally {
    await f.close();
  }
});
test("failed replanning after decline preserves the released task and can be explicitly retried without extending the deadline", async () => {
  const f = await fixture();
  try {
    const mission = await f.create(),
      task = (await f.approve(mission)).json<Task>();
    const generator = f.service.generator.generate.bind(f.service.generator);
    f.service.generator.generate = async () => {
      throw Error("controlled sample planning failure");
    };
    assert.equal((await f.response(task, "declined")).statusCode, 503);
    const state = await f.service.store.read();
    assert.equal(state.tasks[task.id].status, "declined");
    assert.equal(
      state.fixtures.couriers.find((c) => c.id === task.courierId)!.available,
      true,
    );
    assert.equal(state.missions[mission.id].status, "dependency_unavailable");
    assert.equal((await f.response(task, "declined")).statusCode, 200);
    f.service.generator.generate = generator;
    f.advance(60000);
    const response = await f.call(`/v1/missions/${mission.id}/replan`, {});
    assert.equal(response.statusCode, 200, response.body);
    const current = response.json<Mission>();
    assert.equal(current.receipt!.version, 2);
    assert.equal(current.deadlineAt, mission.deadlineAt);
    assert.ok(
      current.receipt!.changeDetails!.reasons.includes("courier_declined"),
    );
    assert.notEqual(current.receipt!.selectedId, mission.receipt!.selectedId);
    assert.equal(Object.keys((await f.service.store.read()).tasks).length, 1);
  } finally {
    await f.close();
  }
});
test("late planning success or failure cannot overwrite a task approved and cancelled during that planning run", async () => {
  for (const fail of [false, true]) {
    const f = await fixture();
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const mission = await f.create();
      const original = f.service.generator.generate.bind(f.service.generator);
      let first = true;
      f.service.generator.generate = async (...args) => {
        if (first) {
          first = false;
          entered();
          await gate;
          if (fail) throw Error("controlled late planner failure");
        }
        return original(...args);
      };
      const pending = f.service
        .plan(mission.owner, mission.id, "Controlled concurrent refresh")
        .then(
          () => null,
          (error: { code: string }) => error,
        );
      await ready;
      const task = (await f.approve(mission)).json<Task>();
      assert.equal(
        (await f.call(`/v1/tasks/${task.id}/cancel`, {})).statusCode,
        200,
      );
      const cancelled = await f.service.store.read();
      release();
      const error = await pending;
      assert.ok(error);
      assert.equal(
        error.code,
        fail ? "invalid_dependency_output" : "concurrent_change",
      );
      assert.deepEqual(await f.service.store.read(), cancelled);
      assert.equal(cancelled.missions[mission.id].status, "cancelled");
      assert.equal(cancelled.missions[mission.id].receipt!.version, 1);
    } finally {
      release();
      await f.close();
    }
  }
});
test("duplicate source controls are no-ops, unknown IDs and cross-owner lifecycle changes preserve state", async () => {
  const f = await fixture();
  try {
    const mission = await f.create(),
      task = (await f.approve(mission)).json<Task>();
    const before = await f.service.store.read();
    assert.equal(
      (
        await f.call(
          `/demo/tasks/${task.id}/response`,
          { status: "declined" },
          true,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (await f.call(`/v1/tasks/${task.id}/cancel`, {}, true)).statusCode,
      404,
    );
    assert.equal(
      (
        await f.call("/demo/disruptions", {
          type: "stock",
          supplierId: "unknown",
          stock: 0,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await f.call("/demo/disruptions", {
          type: "route",
          edgeId: "unknown",
          closed: true,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await f.call("/demo/disruptions", {
          type: "stock",
          supplierId: "supplier-a",
          stock: 6,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await f.call("/demo/disruptions", {
          type: "route",
          edgeId: "E4",
          closed: false,
        })
      ).statusCode,
      200,
    );
    assert.equal((await f.response(task, "accepted", -1)).statusCode, 400);
    assert.deepEqual(await f.service.store.read(), before);
  } finally {
    await f.close();
  }
});
test("budget and time alternatives use separate eligible sets, exclude unproven options and explicitly explain combined or unavailable cases", () => {
  const fixtures = seedFixtures(),
    stamp = "2026-10-22T23:00:00.000Z";
  const request = {
    sku: "HDMI-USB-C" as const,
    quantity: 2,
    destination: "auditorium" as const,
    budgetCents: 3500,
    deadlineMinutes: 20,
  };
  const candidates = enumerateCandidates(
    fixtures,
    request,
    sampleEvidence(fixtures, stamp),
    20,
  );
  const alternative = alternatives(candidates, request, 20);
  assert.equal(alternative.budgetIncreaseCents, 500);
  assert.equal(alternative.deadlineExtensionMinutes, 2);
  assert.equal(alternative.status, "either_change");
  const tight = { ...request, budgetCents: 3000 };
  const neither = alternatives(
    enumerateCandidates(fixtures, tight, sampleEvidence(fixtures, stamp), 20),
    tight,
    20,
  );
  assert.equal(neither.budgetIncreaseCents, 1000);
  assert.equal(neither.deadlineExtensionMinutes, null);
  const combinedRequest = { ...tight, deadlineMinutes: 10 };
  const combined = alternatives(
    enumerateCandidates(
      fixtures,
      combinedRequest,
      sampleEvidence(fixtures, stamp),
      10,
    ),
    combinedRequest,
    10,
  );
  assert.equal(combined.budgetIncreaseCents, null);
  assert.equal(combined.deadlineExtensionMinutes, null);
  assert.equal(combined.status, "combined_change_required");
  assert.match(
    combined.explanation,
    /Neither extra budget alone nor extra time alone/,
  );
  const unproven = alternatives(
    enumerateCandidates(fixtures, request, [], 20),
    request,
    20,
  );
  assert.equal(unproven.status, "no_available_option");
  assert.equal(unproven.budgetIncreaseCents, null);
  assert.equal(unproven.deadlineExtensionMinutes, null);
  const blocked = structuredClone(fixtures);
  blocked.suppliers.forEach((s) => {
    s.stock = 0;
  });
  assert.equal(
    alternatives(
      enumerateCandidates(blocked, request, sampleEvidence(blocked, stamp), 20),
      request,
      20,
    ).status,
    "no_available_option",
  );
  assert.equal(hash(fixtures), hash(seedFixtures()));
  console.log(
    JSON.stringify({
      proof: "alternatives",
      onTimeVersusAffordable: alternative,
      lowerBudget: neither,
      combined,
      missingEvidence: unproven,
    }),
  );
});
test("infeasible receipts report when neither single relaxation works and never modify quantity, compatibility or deadline", async () => {
  const f = await fixture();
  try {
    const request = { ...input, budgetCents: 3000, deadlineMinutes: 10 },
      mission = await f.create(request);
    assert.equal(mission.status, "infeasible");
    assert.equal(
      mission.receipt!.alternatives.status,
      "combined_change_required",
    );
    assert.match(
      mission.receipt!.summary,
      /Neither extra budget alone nor extra time alone/,
    );
    assert.deepEqual(mission.request, request);
    assert.equal((await f.approve(mission)).statusCode, 409);
    f.advance(61000);
    const next = (
      await f.call(`/v1/missions/${mission.id}/replan`, {})
    ).json<Mission>();
    assert.equal(next.deadlineAt, mission.deadlineAt);
    assert.deepEqual(next.request, request);
    assert.equal(Object.keys((await f.service.store.read()).tasks).length, 0);
  } finally {
    await f.close();
  }
});
