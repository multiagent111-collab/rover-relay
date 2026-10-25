import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import { configuration } from "../src/config.ts";
import { extractDraft } from "../src/intake.ts";
import { actionSchema, observationPolicy } from "../src/coordinator.ts";
import type { Mission, MissionRequest } from "../src/types.ts";
const request: MissionRequest = {
  sku: "HDMI-USB-C",
  quantity: 2,
  destination: "auditorium",
  budgetCents: 3500,
  deadlineMinutes: 30,
};
const complete =
  "Two USB-C to HDMI adapters to the auditorium within 30 minutes, total budget $35.";
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "relay-intake-test-"));
  let now = Date.parse("2026-10-22T20:00:00Z");
  const config = {
    ...configuration(),
    sample: true,
    demo: true,
    databaseUrl: "",
    dataDir: directory,
  };
  let opened = await createApp({ config, clock: () => now });
  return {
    get app() {
      return opened.app;
    },
    get service() {
      return opened.service;
    },
    advance: (ms: number) => {
      now += ms;
    },
    async reopen() {
      await opened.app.close();
      opened = await createApp({ config, clock: () => now });
    },
    async dispose() {
      await opened.app.close();
      assert.ok(directory.startsWith(join(tmpdir(), "relay-intake-test-")));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
test("bounded draft extraction finds canonical fields and clarifies conflicting, unsupported and fractional constraints", () => {
  assert.deepEqual(extractDraft(complete).fields, request);
  assert.equal(
    extractDraft("two adapters for my event soon").fields.sku,
    undefined,
  );
  assert.equal(
    extractDraft("two adapters for my event soon").questions.length,
    4,
  );
  const conflict = extractDraft(
    "two USB-C to HDMI adapters to auditorium or library, $35 or $45, 20 minutes or 30 minutes",
  );
  for (const field of ["destination", "budgetCents", "deadlineMinutes"])
    assert.ok(conflict.conflicts.includes(field as never));
  for (const text of ["HDMI to USB-C adapters", "USB-C to VGA adapters"])
    assert.ok(extractDraft(text).questions.some((q) => q.field === "sku"));
  assert.equal(extractDraft("2.5 adapters").fields.quantity, undefined);
  assert.equal(
    extractDraft("two or three adapters").fields.quantity,
    undefined,
  );
  assert.equal(
    extractDraft("$35 delivery-only budget").fields.budgetCents,
    undefined,
  );
  assert.equal(extractDraft("budget $35.15").fields.budgetCents, 3515);
  assert.equal(extractDraft("budget $35.123").fields.budgetCents, undefined);
  assert.throws(() => extractDraft("x".repeat(1001)));
});
test("incomplete drafts persist needs_input without sources, inference, memory-derived requirements or tasks", async () => {
  const f = await fixture();
  try {
    f.service.data.snapshot = async () => {
      assert.fail("Draft called a source");
    };
    f.service.generator.generate = async () => {
      assert.fail("Draft called inference");
    };
    f.service.memory.recall = () => {
      assert.fail("Draft inferred constraints from memory");
    };
    const response = await f.app.inject({
      method: "POST",
      url: "/v1/intakes",
      payload: { text: "two adapters for my event soon" },
    });
    assert.equal(response.statusCode, 201, response.body);
    const draft = response.json();
    assert.equal(draft.status, "needs_input");
    assert.equal(draft.fields.quantity, 2);
    assert.equal(draft.deadlineAt, null);
    const state = await f.service.store.read();
    assert.equal(Object.keys(state.tasks).length, 0);
    assert.equal(Object.keys(state.missions).length, 0);
    const denied = await f.app.inject({
      url: `/v1/intakes/${draft.id}`,
      headers: { "x-relay-demo-user": "reviewer" },
    });
    assert.equal(denied.statusCode, 404);
    await f.reopen();
    assert.equal(
      (await f.app.inject({ url: `/v1/intakes/${draft.id}` })).json().revision,
      1,
    );
    assert.equal(
      (
        await f.app.inject({
          url: "/v1/bootstrap",
          headers: { "x-relay-demo-user": "reviewer" },
        })
      ).json().intakes.length,
      0,
    );
  } finally {
    await f.dispose();
  }
});
test("explicit confirmation resumes the same mission and normal checked approval path while retaining the original deadline", async () => {
  const f = await fixture();
  try {
    const first = (
      await f.app.inject({
        method: "POST",
        url: "/v1/intakes",
        payload: { text: complete },
      })
    ).json();
    assert.equal(first.status, "needs_input");
    assert.equal(first.questions.length, 0);
    f.advance(120000);
    await f.reopen();
    const response = await f.app.inject({
      method: "POST",
      url: `/v1/intakes/${first.id}/confirm`,
      payload: { revision: 1, confirmed: true, request },
    });
    assert.equal(response.statusCode, 200, response.body);
    const mission = response.json<Mission>();
    assert.equal(mission.id, first.id);
    assert.equal(mission.createdAt, first.createdAt);
    assert.equal(mission.deadlineAt, first.deadlineAt);
    assert.equal(mission.status, "awaiting_approval");
    assert.equal(mission.receipt!.coordination!.budget.selectionCalls, 0);
    assert.equal(mission.receipt!.coordination!.budget.extractionCalls, 0);
    const replay = await f.app.inject({
      method: "POST",
      url: `/v1/intakes/${first.id}/confirm`,
      payload: { revision: 1, confirmed: true, request },
    });
    assert.equal(replay.json().receipt.digest, mission.receipt!.digest);
    const receipt = mission.receipt!;
    const approval = await f.app.inject({
      method: "POST",
      url: `/v1/missions/${mission.id}/approve`,
      payload: {
        version: receipt.version,
        digest: receipt.digest,
        idempotencyKey: "intake-confirm-approval",
      },
    });
    assert.equal(approval.statusCode, 200, approval.body);
    assert.equal(Object.keys((await f.service.store.read()).tasks).length, 1);
    const events = await f.service.events(mission.owner, mission.id);
    assert.ok(events.some((e) => e.type === "intake_created"));
    assert.ok(events.some((e) => e.type === "mission_confirmed"));
    assert.ok(events.some((e) => e.type === "coordinator_action"));
  } finally {
    await f.dispose();
  }
});
test("reviewed fields resolve conflicts, stale revisions and unconfirmed/mismatched bodies cannot plan", async () => {
  const f = await fixture();
  try {
    let draft = (
      await f.app.inject({
        method: "POST",
        url: "/v1/intakes",
        payload: { text: "two adapters for library or auditorium, $35 or $45" },
      })
    ).json();
    assert.ok(draft.questions.length);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/intakes/${draft.id}/confirm`,
          payload: { revision: 1, confirmed: true, request },
        })
      ).statusCode,
      409,
    );
    const patch = await f.app.inject({
      method: "PATCH",
      url: `/v1/intakes/${draft.id}`,
      payload: { revision: 1, fields: request },
    });
    assert.equal(patch.statusCode, 200, patch.body);
    draft = patch.json();
    assert.equal(draft.questions.length, 0);
    assert.equal(
      (
        await f.app.inject({
          method: "PATCH",
          url: `/v1/intakes/${draft.id}`,
          payload: { revision: 1, fields: { quantity: 3 } },
        })
      ).statusCode,
      409,
    );
    for (const body of [
      { revision: 2, confirmed: false, request },
      { revision: 1, confirmed: true, request },
      {
        revision: 2,
        confirmed: true,
        request: { ...request, budgetCents: 9999 },
      },
    ])
      assert.ok(
        [400, 409].includes(
          (
            await f.app.inject({
              method: "POST",
              url: `/v1/intakes/${draft.id}/confirm`,
              payload: body,
            })
          ).statusCode,
        ),
      );
    assert.equal(Object.keys((await f.service.store.read()).tasks).length, 0);
    assert.equal(
      Object.keys((await f.service.store.read()).missions).length,
      0,
    );
  } finally {
    await f.dispose();
  }
});
test("waiting and editing cannot reset or extend a draft deadline, even if deadline is supplied after clarification", async () => {
  const f = await fixture();
  try {
    const draft = (
      await f.app.inject({
        method: "POST",
        url: "/v1/intakes",
        payload: { text: "two adapters within 1 minute" },
      })
    ).json();
    f.advance(61000);
    assert.equal(
      (
        await f.app.inject({
          method: "PATCH",
          url: `/v1/intakes/${draft.id}`,
          payload: { revision: 1, fields: request },
        })
      ).json().error,
      "deadline_locked",
    );
    const reviewed = (
      await f.app.inject({
        method: "PATCH",
        url: `/v1/intakes/${draft.id}`,
        payload: { revision: 1, fields: { ...request, deadlineMinutes: 1 } },
      })
    ).json();
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/v1/intakes/${draft.id}/confirm`,
          payload: {
            revision: reviewed.revision,
            confirmed: true,
            request: { ...request, deadlineMinutes: 1 },
          },
        })
      ).json().error,
      "deadline_elapsed",
    );
    const unknown = (
      await f.app.inject({
        method: "POST",
        url: "/v1/intakes",
        payload: { text: "two adapters" },
      })
    ).json();
    f.advance(120000);
    const updated = (
      await f.app.inject({
        method: "PATCH",
        url: `/v1/intakes/${unknown.id}`,
        payload: { revision: 1, fields: request },
      })
    ).json();
    assert.equal(
      Date.parse(updated.deadlineAt),
      Date.parse(unknown.createdAt) + 1800000,
    );
    assert.equal(Object.keys((await f.service.store.read()).tasks).length, 0);
  } finally {
    await f.dispose();
  }
});
test("allowlisted actions reject SQL, URLs, unknown keys and dispatch; injected decisions cannot bypass observed stages", async () => {
  for (const action of [
    { type: "execute_sql", sql: "DELETE FROM relay_state" },
    { type: "dispatch" },
    {
      type: "read_equipment_options",
      sku: "HDMI-USB-C",
      quantity: 2,
      url: "https://private.invalid",
    },
    {
      type: "read_courier_availability",
      supplierIds: ["https://private.invalid"],
    },
  ])
    assert.equal(actionSchema.safeParse(action).success, false);
  const f = await fixture();
  try {
    f.service.data.snapshot = async () => {
      assert.fail("Unsafe action reached data adapter");
    };
    f.service.decision = {
      usesInference: false,
      select: async () => ({ type: "propose" }),
    };
    await assert.rejects(
      f.service.create({ tenant: "relay-demo", user: "coordinator" }, request),
      { code: "invalid_action" },
    );
    f.service.decision = {
      usesInference: false,
      select: async () => ({
        type: "execute_sql",
        sql: "DROP TABLE relay_state",
      }),
    };
    await assert.rejects(
      f.service.create({ tenant: "relay-demo", user: "coordinator" }, request),
      { code: "invalid_action" },
    );
    assert.equal(Object.keys((await f.service.store.read()).tasks).length, 0);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/v1/intakes",
          payload: { text: "two adapters", sql: "SELECT *" },
        })
      ).statusCode,
      400,
    );
  } finally {
    await f.dispose();
  }
});
test("different observations change next actions: no stock skips courier/route reads, no courier skips routes, feasible stock proposes", async () => {
  for (const mode of ["stock", "courier", "feasible"]) {
    const f = await fixture();
    try {
      await f.service.store.transact((state) => {
        if (mode === "stock")
          state.fixtures.suppliers.forEach((s) => (s.stock = 0));
        if (mode === "courier")
          state.fixtures.couriers.forEach((c) => (c.available = false));
      });
      let fetches = 0;
      const original = f.service.data.snapshot.bind(f.service.data);
      f.service.data.snapshot = async (...args) => {
        fetches++;
        return original(...args);
      };
      const mission = await f.service.create(
        { tenant: "relay-demo", user: "coordinator" },
        request,
      );
      const coordination = mission.receipt!.coordination!;
      assert.equal(fetches, 1);
      assert.equal(
        coordination.budget.toolCalls,
        mode === "stock" ? 1 : mode === "courier" ? 2 : 3,
      );
      const terminal = coordination.actions.at(-1)!.action;
      assert.deepEqual(
        terminal,
        mode === "stock"
          ? { type: "finish_infeasible", reason: "no_stock" }
          : mode === "courier"
            ? { type: "finish_infeasible", reason: "no_courier" }
            : { type: "propose" },
      );
      assert.equal(Object.keys((await f.service.store.read()).tasks).length, 0);
    } finally {
      await f.dispose();
    }
  }
});
test("Critic refresh and one repair share six reads; exhaustion does not perform a discarded extra refresh", async () => {
  const f = await fixture();
  try {
    const original = f.service.generator.generate.bind(f.service.generator);
    f.service.generator.generate = async (role, input, signal) =>
      role === "Critic"
        ? {
            provider: "controlled",
            model: "controlled",
            value: {
              approved: false,
              issues: [{ code: "refresh_required", field: "proposal" }],
              refreshEvidence: true,
            },
          }
        : original(role, input, signal);
    await assert.rejects(
      f.service.create({ tenant: "relay-demo", user: "coordinator" }, request),
      { code: "reasoning_exhausted" },
    );
    const state = await f.service.store.read();
    assert.equal(Object.keys(state.tasks).length, 0);
    const usage = state.events.find((e) => e.type === "planning_budget")!.data;
    assert.equal(usage.toolCalls, 6);
    assert.equal(usage.inferenceCalls, 4);
  } finally {
    await f.dispose();
  }
});
test("injected selection calls consume the same total inference budget as Planner/Critic", async () => {
  const f = await fixture();
  try {
    f.service.decision = {
      usesInference: true,
      select: observationPolicy.select,
    };
    const mission = await f.service.create(
      { tenant: "relay-demo", user: "coordinator" },
      request,
    );
    const budget = mission.receipt!.coordination!.budget;
    assert.equal(budget.selectionCalls, 4);
    assert.equal(budget.plannerCriticCalls, 2);
    assert.equal(budget.inferenceCalls, 6);
    f.service.planningLimits.inference = 2;
    await assert.rejects(
      f.service.create({ tenant: "relay-demo", user: "coordinator" }, request),
      { code: "inference_budget_exhausted" },
    );
    assert.equal(Object.keys((await f.service.store.read()).tasks).length, 0);
  } finally {
    await f.dispose();
  }
});
test("the overall deadline bounds adapters that ignore cancellation and persists failure without dispatch", async () => {
  const f = await fixture();
  try {
    f.service.planningLimits.timeoutMs = 30;
    let signal: AbortSignal | undefined;
    f.service.data.snapshot = async (_identity, received) => {
      signal = received;
      return new Promise(() => {});
    };
    await assert.rejects(
      f.service.create({ tenant: "relay-demo", user: "coordinator" }, request),
      { code: "planning_cancelled" },
    );
    assert.equal(signal!.aborted, true);
    const state = await f.service.store.read();
    assert.equal(
      Object.values(state.missions)[0].status,
      "dependency_unavailable",
    );
    assert.equal(Object.keys(state.tasks).length, 0);
  } finally {
    await f.dispose();
  }
});
test("caller cancellation propagates through the shared signal and blocks late model results", async () => {
  const f = await fixture();
  try {
    let resolve: (value: unknown) => void = () => {};
    let received: AbortSignal | undefined;
    f.service.generator.generate = async (_role, _input, signal) => {
      received = signal;
      return new Promise((accept) => {
        resolve = accept as typeof resolve;
      });
    };
    const controller = new AbortController();
    const result = f.service.create(
      { tenant: "relay-demo", user: "coordinator" },
      request,
      controller.signal,
    );
    const timer = setTimeout(() => controller.abort(), 25);
    await assert.rejects(result, { code: "planning_cancelled" });
    clearTimeout(timer);
    assert.equal(received!.aborted, true);
    resolve({
      value: { candidateId: null, evidenceIds: [], summary: "late" },
      provider: "controlled",
      model: "controlled",
    });
    assert.equal(Object.keys((await f.service.store.read()).tasks).length, 0);
  } finally {
    await f.dispose();
  }
});
