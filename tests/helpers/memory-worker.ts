import assert from "node:assert/strict";
import { createApp } from "../../src/app.ts";
import { configuration } from "../../src/config.ts";
import type { Mission, Task, MemoryContext } from "../../src/types.ts";
const [phase, directory, missionId] = process.argv.slice(2);
if (!["seed", "resume", "verify"].includes(phase) || !directory)
  throw Error("Isolated worker arguments required");
globalThis.fetch = async () => {
  throw Error("Offline memory verification attempted external fetch");
};
const opened = await createApp({
  config: {
    ...configuration(),
    sample: true,
    demo: true,
    databaseUrl: "",
    dataDir: directory,
    planTtlSeconds: 1800,
  },
});
const inputs: {
  role: string;
  entrance: string | null;
  ids: string[];
  context: string;
}[] = [];
const original = opened.service.generator.generate.bind(
  opened.service.generator,
);
opened.service.generator.generate = async (role, input, signal) => {
  inputs.push({
    role,
    entrance: input.memory.entrance,
    ids: input.memory.records.map((r) => r.id),
    context: input.memory.context,
  });
  return original(role, input, signal);
};
const call = async (
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  reviewer = false,
) =>
  opened.app.inject({
    method,
    url,
    payload: payload as never,
    headers: reviewer ? { "x-relay-demo-user": "reviewer" } : {},
  });
const request = {
  sku: "HDMI-USB-C",
  quantity: 2,
  destination: "auditorium",
  budgetCents: 3500,
  deadlineMinutes: 30,
};
const preference = (entrance: string, venue = "auditorium", reviewer = false) =>
  call("PUT", "/v1/preferences/entrance", { venue, entrance }, reviewer);
const approve = (mission: Mission, reviewer = false) =>
  call(
    "POST",
    `/v1/missions/${mission.id}/approve`,
    {
      version: mission.receipt!.version,
      digest: mission.receipt!.digest,
      idempotencyKey: `memory-${mission.id}-${mission.receipt!.version}`,
    },
    reviewer,
  );
const plan = async () => {
  const response = await call("POST", "/v1/missions", request);
  assert.equal(response.statusCode, 201, response.body);
  return response.json<Mission>();
};
const report: Record<string, unknown> = {
  phase,
  pid: process.pid,
  startedAt: new Date().toISOString(),
  mode: "offline_sample",
  generator: "deterministic sample substitute; no hosted call",
  testPlanTtlSeconds: 1800,
};
try {
  if (phase === "seed") {
    assert.equal(
      (await preference("Original north test entrance")).statusCode,
      200,
    );
    assert.equal(
      (await preference("Other venue test door", "library")).statusCode,
      200,
    );
    assert.equal(
      (await preference("Reviewer test door", "auditorium", true)).statusCode,
      200,
    );
    const mission = await plan();
    assert.equal(
      mission.receipt!.review!.terms.entrance,
      "Original north test entrance",
    );
    assert.ok(
      inputs.some((i) => i.role === "Planner") &&
        inputs.some((i) => i.role === "Critic"),
    );
    assert.ok(
      inputs.every((i) => i.entrance === "Original north test entrance"),
    );
    Object.assign(report, {
      missionId: mission.id,
      initialRevision: mission.receipt!.memoryRevision,
      originalMemoryIds: mission.receipt!.memory.records.map((r) => r.id),
      modelRoles: inputs.map((i) => ({
        role: i.role,
        entrance: i.entrance,
        ids: i.ids,
      })),
    });
  } else if (phase === "resume") {
    const recalled = (
      await call("GET", "/v1/preferences/entrance?venue=auditorium")
    ).json<MemoryContext>();
    assert.equal(recalled.entrance, "Original north test entrance");
    const old = (
      await call("GET", `/v1/missions/${missionId}`)
    ).json<Mission>();
    const corrected = (
      await preference("Corrected south test entrance")
    ).json<MemoryContext>();
    assert.notEqual(corrected.revision, old.receipt!.memoryRevision);
    assert.equal((await approve(old)).statusCode, 409);
    let current = (
      await call("GET", `/v1/missions/${missionId}`)
    ).json<Mission>();
    assert.equal(
      current.receipt!.review!.terms.entrance,
      "Corrected south test entrance",
    );
    assert.equal(current.deadlineAt, old.deadlineAt);
    assert.ok(
      inputs.every(
        (i) =>
          i.entrance === "Corrected south test entrance" &&
          !i.context.includes("Original north test entrance"),
      ),
    );
    const correctedInputs = inputs
      .splice(0)
      .map((i) => ({ role: i.role, entrance: i.entrance, ids: i.ids }));
    const response = await approve(current);
    assert.equal(response.statusCode, 200, response.body);
    const task = response.json<Task>();
    assert.equal(task.entrance, "Corrected south test entrance");
    assert.equal(
      (await call("POST", `/v1/tasks/${task.id}/cancel`)).statusCode,
      200,
    );
    const beforeForget = await plan();
    inputs.length = 0;
    const forgotten = (
      await call("DELETE", "/v1/preferences/entrance", { venue: "auditorium" })
    ).json<MemoryContext>();
    assert.equal(forgotten.entrance, null);
    assert.deepEqual(forgotten.records, []);
    assert.equal((await approve(beforeForget)).statusCode, 409);
    const afterForget = (
      await call("GET", `/v1/missions/${beforeForget.id}`)
    ).json<Mission>();
    assert.ok(
      inputs.some((i) => i.role === "Planner") &&
        inputs.some((i) => i.role === "Critic"),
    );
    assert.ok(
      inputs.every(
        (i) =>
          i.entrance === null &&
          i.ids.length === 0 &&
          !i.context.includes("test entrance"),
      ),
    );
    const emptyInputs = inputs.map((i) => ({
      role: i.role,
      entrance: i.entrance,
      ids: i.ids,
    }));
    const approvedEmpty = await approve(afterForget);
    assert.equal(approvedEmpty.statusCode, 200, approvedEmpty.body);
    const emptyTask = approvedEmpty.json<Task>();
    assert.equal(emptyTask.entrance, null);
    assert.equal(
      (await call("GET", `/v1/missions/${beforeForget.id}`, undefined, true))
        .statusCode,
      404,
    );
    assert.equal((await approve(afterForget, true)).statusCode, 404);
    assert.equal(
      (await call("GET", `/v1/tasks/${emptyTask.id}`, undefined, true))
        .statusCode,
      404,
    );
    await call("POST", `/v1/tasks/${emptyTask.id}/cancel`);
    Object.assign(report, {
      missionId,
      recallAfterProcessRestart: recalled.entrance,
      recallIds: recalled.records.map((r) => r.id),
      correctedIds: corrected.records.map((r) => r.id),
      oldApprovalStatus: 409,
      correctedModelRoles: correctedInputs,
      correctedTask: {
        id: task.id,
        entrance: task.entrance,
        statusAfterTest: "cancelled",
      },
      forgetStaleApprovalStatus: 409,
      forgottenModelRoles: emptyInputs,
      forgottenTask: {
        id: emptyTask.id,
        entrance: emptyTask.entrance,
        statusAfterTest: "cancelled",
      },
      crossUserStatuses: [404, 404, 404],
    });
  } else {
    assert.equal(
      (
        await call("GET", "/v1/preferences/entrance?venue=auditorium")
      ).json<MemoryContext>().entrance,
      null,
    );
    assert.equal(
      (
        await call("GET", "/v1/preferences/entrance?venue=library")
      ).json<MemoryContext>().entrance,
      "Other venue test door",
    );
    assert.equal(
      (
        await call(
          "GET",
          "/v1/preferences/entrance?venue=auditorium",
          undefined,
          true,
        )
      ).json<MemoryContext>().entrance,
      "Reviewer test door",
    );
    const audit = opened.service.memory.audit(
      { tenant: "relay-demo", user: "coordinator" },
      "auditorium",
    );
    assert.ok(audit.length >= 2);
    assert.ok(audit.every((r) => r.history.some((e) => e.action === "delete")));
    const state = await opened.service.store.read();
    assert.ok(
      state.events
        .filter((e) => e.type === "memory_retrieved")
        .every((e) => !JSON.stringify(e.data).includes("test entrance")),
    );
    Object.assign(report, {
      forgottenPreferenceAbsentAfterSecondRestart: true,
      otherVenueAndUserPreserved: true,
      retainedAudit: audit.map((r) => ({
        id: r.id,
        actions: r.history.map((e) => e.action),
      })),
      activeTasks: Object.values(state.tasks).filter(
        (t) => !["cancelled", "completed", "declined"].includes(t.status),
      ).length,
    });
  }
} finally {
  await opened.app.close();
}
report.closedAt = new Date().toISOString();
report.writerClosed = true;
console.log(JSON.stringify(report));
