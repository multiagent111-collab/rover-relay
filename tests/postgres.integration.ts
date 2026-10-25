import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { createApp } from "../src/app.ts";
import { configuration } from "../src/config.ts";
import { PostgresStore } from "../src/store.ts";
import { RelayService } from "../src/service.ts";
import { HttpGatewayExecutor } from "../src/adapters/http-executor.ts";
import { SampleData } from "../src/adapters/data.ts";
import { gatewayFixture } from "./helpers/gateway-fixture.ts";
import { parseExecutionIntent } from "../src/execution-contract.ts";
import type { Mission, State, Task } from "../src/types.ts";

// Deliberately outside *.test.ts: npm run test:postgres creates the only target.
const base = process.env.RELAY_PG_TEST_URL;
const token = process.env.RELAY_PG_TEST_RUN;
const directory = process.env.RELAY_PG_TEST_DIR;
if (!base || !token || !directory || !/^[a-f0-9-]{36}$/.test(token))
  throw Error("Use npm run test:postgres; an isolated container is required");
const target = new URL(base);
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.pathname, "/relay_test");
assert.notEqual(target.port, "15432");
const input = {
  sku: "HDMI-USB-C",
  quantity: 2,
  destination: "auditorium",
  budgetCents: 3500,
  deadlineMinutes: 30,
};
const nativeFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw Error("Offline PostgreSQL test attempted external fetch");
};

async function fixture(realClock = false) {
  const schema = `case_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: base });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const url = new URL(base!);
  url.searchParams.set("options", `-c search_path=${schema}`);
  url.searchParams.set("application_name", schema);
  const dataDir = join(directory!, schema);
  await mkdir(dataDir);
  let now = Date.parse("2026-10-22T23:00:00Z");
  const config = {
    ...configuration(),
    sample: true,
    demo: true,
    databaseUrl: url.href,
    dataDir,
    planTtlSeconds: realClock ? 1800 : 60,
  };
  const open = () =>
    createApp({ config, clock: realClock ? Date.now : () => now });
  let opened = await open();
  const probe = new pg.Pool({ connectionString: url.href });
  const create = async (reviewer = false) => {
    const response = await opened.app.inject({
      method: "POST",
      url: "/v1/missions",
      payload: input,
      headers: reviewer ? { "x-relay-demo-user": "reviewer" } : {},
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json<Mission>();
  };
  const approve = (
    mission: Mission,
    key = `approve-${mission.id}`,
    reviewer = false,
    digest = mission.receipt!.digest,
  ) =>
    opened.app.inject({
      method: "POST",
      url: `/v1/missions/${mission.id}/approve`,
      headers: reviewer ? { "x-relay-demo-user": "reviewer" } : {},
      payload: {
        version: mission.receipt!.version,
        digest,
        idempotencyKey: key,
      },
    });
  const waitForLocks = async (count: number) => {
    for (let n = 0; n < 150; n++) {
      const result = await admin.query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'SELECT value%FOR UPDATE'",
        [schema],
      );
      if (result.rows[0].n >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail(`Expected ${count} real PostgreSQL row-lock waiters`);
  };
  const lock = async () => {
    const client = await probe.connect();
    await client.query("BEGIN");
    await client.query("SELECT value FROM relay_state WHERE id=1 FOR UPDATE");
    return async () => {
      await client.query("ROLLBACK");
      client.release();
    };
  };
  return {
    config,
    probe,
    url: url.href,
    create,
    approve,
    open,
    waitForLocks,
    lock,
    get opened() {
      return opened;
    },
    restart: async () => {
      await opened.app.close();
      opened = await open();
    },
    advance: (ms: number) => {
      now += ms;
    },
    state: async (): Promise<State> =>
      (await probe.query("SELECT value FROM relay_state WHERE id=1")).rows[0]
        .value,
    close: async () => {
      await opened.app.close();
      await probe.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function crash(
  f: Fixture,
  phase: "approval" | "outbox",
  mission: Mission,
  key: string,
) {
  await f.opened.app.close();
  let boundary = "";
  const child = fork(
    new URL("./helpers/postgres-crash-worker.ts", import.meta.url),
    [phase, f.config.dataDir, mission.id, key],
    {
      execArgv: ["--import", "tsx"],
      env: { ...process.env, RELAY_PG_TEST_URL: f.url },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  // Worker stderr is intentionally not reflected: a failed driver can contain a URL.
  child.stderr?.resume();
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("message", (message: { boundary?: string }) => {
        boundary = message.boundary || "";
      });
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(code, 73, "Worker must exit at the real post-COMMIT boundary");
    assert.equal(
      boundary,
      phase === "approval"
        ? "approval_committed_before_response"
        : "outbox_committed_before_response",
    );
    // The app deliberately retains locks after an unclean exit. Remove only
    // this test worker's stale lock, after the OS exit event and PID check.
    const lockPath = join(f.config.dataDir, ".relay-writer.lock");
    const raw = await readFile(lockPath, "utf8");
    assert.equal(JSON.parse(raw).pid, child.pid);
    assert.throws(
      () => process.kill(child.pid!, 0),
      (error: NodeJS.ErrnoException) => error.code === "ESRCH",
    );
    assert.equal(await readFile(lockPath, "utf8"), raw);
    await unlink(lockPath);
  } finally {
    clearTimeout(timer);
  }
}
function invariant(state: State, count: number) {
  assert.equal(Object.keys(state.tasks).length, count);
  assert.equal(Object.keys(state.idempotency).length, count);
  assert.equal(state.outbox.length, count);
  assert.equal(
    state.events.filter((e) => e.type === "dispatch_committed").length,
    count,
  );
  assert.equal(
    new Set(Object.values(state.tasks).map((t) => t.courierId)).size,
    count,
  );
  for (const task of Object.values(state.tasks)) {
    assert.equal(state.missions[task.missionId].taskId, task.id);
    assert.equal(
      state.missions[task.missionId].receipt!.digest,
      task.planDigest,
    );
    assert.equal(
      state.fixtures.couriers.find((c) => c.id === task.courierId)!.available,
      false,
    );
    assert.equal(state.outbox.filter((o) => o.taskId === task.id).length, 1);
  }
}

test("PostgreSQL: eight approvals overlap at the row lock and replay one committed task", async () => {
  const f = await fixture();
  try {
    const mission = await f.create();
    const unlock = await f.lock();
    const pending = Array.from({ length: 8 }, () => f.approve(mission));
    try {
      await f.waitForLocks(2);
    } finally {
      await unlock();
    }
    const responses = await Promise.all(pending);
    responses.forEach((r) => assert.equal(r.statusCode, 200, r.body));
    assert.equal(new Set(responses.map((r) => r.json<Task>().id)).size, 1);
    const state = await f.state();
    invariant(state, 1);
    assert.equal(
      state.events.filter((e) => e.type === "simulated_offer_sent").length,
      1,
    );
    assert.ok(state.outbox.every((o) => o.delivered));
    console.log(
      JSON.stringify({
        proof: "overlapping_approvals",
        requests: responses.length,
        observedRowLockWaitersAtLeast: 2,
        taskId: responses[0].json<Task>().id,
        tasks: Object.keys(state.tasks).length,
        outboxMessages: state.outbox.length,
        dispatchEvents: state.events.filter(
          (e) => e.type === "dispatch_committed",
        ).length,
        offerEvents: state.events.filter(
          (e) => e.type === "simulated_offer_sent",
        ).length,
      }),
    );
  } finally {
    await f.close();
  }
});
test("PostgreSQL: a duplicate whose source read finishes after the first COMMIT returns the original task", async () => {
  const f = await fixture();
  let releaseSecond!: () => void;
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  let bothEntered!: () => void;
  const bothGate = new Promise<void>((resolve) => {
    bothEntered = resolve;
  });
  let calls = 0;
  try {
    const mission = await f.create();
    const snapshot = f.opened.service.data.snapshot.bind(f.opened.service.data);
    f.opened.service.data.snapshot = async (...args) => {
      const call = ++calls;
      if (call === 1) await bothGate;
      if (call === 2) {
        bothEntered();
        await secondGate;
      }
      return snapshot(...args);
    };
    const pending = [f.approve(mission), f.approve(mission)];
    const first = await Promise.race(pending);
    assert.equal(first.statusCode, 200, first.body);
    releaseSecond();
    const responses = await Promise.all(pending);
    for (const response of responses) {
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json<Task>().id, first.json<Task>().id);
    }
    assert.equal(calls, 2);
    invariant(await f.state(), 1);
  } finally {
    releaseSecond();
    bothEntered();
    await f.close();
  }
});
test("PostgreSQL: competing keys and competing missions cannot double reserve one courier", async () => {
  for (const sameMission of [true, false]) {
    const f = await fixture();
    try {
      const one = await f.create(),
        two = sameMission ? one : await f.create();
      assert.equal(one.receipt!.selectedId, two.receipt!.selectedId);
      const unlock = await f.lock();
      const pending = [
        f.approve(one, "competing-key-one"),
        f.approve(two, "competing-key-two"),
      ];
      try {
        await f.waitForLocks(2);
      } finally {
        await unlock();
      }
      const responses = await Promise.all(pending);
      assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
      invariant(await f.state(), 1);
    } finally {
      await f.close();
    }
  }
});
test("PostgreSQL: crash after approval COMMIT and after outbox COMMIT preserves IDs and terms on restart/retry", async () => {
  const f = await fixture(true);
  try {
    f.opened.service.memory.set(
      { tenant: "relay-demo", user: "coordinator" },
      "auditorium",
      "Confirmed PostgreSQL test entrance",
    );
    const mission = await f.create(),
      key = "crash-original-key";
    await crash(f, "approval", mission, key);
    const queued = await f.state();
    invariant(queued, 1);
    const task = Object.values(queued.tasks)[0];
    assert.equal(task.status, "queued");
    assert.equal(queued.outbox[0].delivered, false);
    assert.equal(
      queued.events.filter((e) => e.type === "simulated_offer_sent").length,
      0,
    );
    assert.equal(task.entrance, "Confirmed PostgreSQL test entrance");
    await crash(f, "outbox", mission, key);
    const delivered = await f.state();
    invariant(delivered, 1);
    assert.equal(delivered.outbox[0].id, queued.outbox[0].id);
    assert.equal(delivered.outbox[0].delivered, true);
    assert.equal(delivered.tasks[task.id].status, "dispatch_requested");
    const event = delivered.events.find(
      (e) => e.type === "simulated_offer_sent",
    )!;
    assert.equal(event.data.eventId, queued.outbox[0].id);
    await f.restart();
    const response = await f.approve(mission, key);
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json<Task>(), {
      ...task,
      status: "dispatch_requested",
      revision: (task.revision ?? 0) + 1,
    });
    await Promise.all([
      f.opened.service.drainOutbox(),
      f.opened.service.drainOutbox(),
    ]);
    await f.restart();
    const recovered = await f.state();
    invariant(recovered, 1);
    assert.deepEqual(recovered.outbox, delivered.outbox);
    assert.deepEqual(recovered.events, delivered.events);
    assert.equal(recovered.missions[mission.id].deadlineAt, mission.deadlineAt);
    assert.equal(recovered.tasks[task.id].planDigest, mission.receipt!.digest);
    console.log(
      JSON.stringify({
        proof: "crash_recovery",
        taskId: task.id,
        outboxId: queued.outbox[0].id,
        dispatchEventId: recovered.events.find(
          (e) => e.type === "dispatch_committed",
        )!.id,
        offerEventId: event.id,
        digest: task.planDigest,
        version: task.planVersion,
        deadlineAt: mission.deadlineAt,
        entrance: task.entrance,
        queuedBeforeRecovery: true,
        originalTaskAndEventIdsPreserved: true,
        retriesAndDrainsAddedEvents:
          recovered.events.length - delivered.events.length,
      }),
    );
  } finally {
    await f.close();
  }
});
test("PostgreSQL: original key conflicts on changed payload, is owner scoped and denies cross-owner replay", async () => {
  const f = await fixture();
  try {
    const one = await f.create();
    assert.equal((await f.approve(one, "owner-scoped-key")).statusCode, 200);
    const changed = await f.approve(
      one,
      "owner-scoped-key",
      false,
      "0".repeat(64),
    );
    assert.equal(changed.statusCode, 409);
    assert.equal(changed.json().error, "idempotency_conflict");
    assert.equal(
      (await f.approve(one, "owner-scoped-key", true)).statusCode,
      404,
    );
    const two = await f.create(true);
    assert.equal(
      (await f.approve(two, "owner-scoped-key", true)).statusCode,
      200,
    );
    const state = await f.state();
    invariant(state, 2);
    assert.notEqual(
      Object.values(state.idempotency)[0].taskId,
      Object.values(state.idempotency)[1].taskId,
    );
  } finally {
    await f.close();
  }
});
test("PostgreSQL: expiry while waiting on the lock and replanning preserve the absolute deadline", async () => {
  const f = await fixture();
  try {
    const mission = await f.create();
    const unlock = await f.lock(),
      pending = f.approve(mission);
    try {
      await f.waitForLocks(1);
      f.advance(61000);
    } finally {
      await unlock();
    }
    assert.equal((await pending).statusCode, 409);
    invariant(await f.state(), 0);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await f.opened.app.inject({
        method: "POST",
        url: `/v1/missions/${mission.id}/replan`,
      });
      assert.equal(response.statusCode, 200, response.body);
      const current = response.json<Mission>();
      assert.equal(current.deadlineAt, mission.deadlineAt);
      assert.ok(
        Date.parse(current.receipt!.expiresAt) <=
          Date.parse(mission.deadlineAt),
      );
      f.advance(61000);
    }
  } finally {
    await f.close();
  }
});
test("PostgreSQL: row-lock timeout rolls back, returns safe 503, then original approval succeeds", async () => {
  const f = await fixture();
  try {
    const mission = await f.create(),
      unlock = await f.lock();
    const start = Date.now();
    let response;
    try {
      response = await f.approve(mission, "timeout-original-key");
    } finally {
      await unlock();
    }
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(response.json().error, "storage_unavailable");
    assert.ok(Date.now() - start < 9000, "Lock wait must be bounded");
    assert.ok(!response.body.includes(f.url));
    invariant(await f.state(), 0);
    assert.equal(
      (await f.approve(mission, "timeout-original-key")).statusCode,
      200,
    );
    invariant(await f.state(), 1);
  } finally {
    await f.close();
  }
});
test("PostgreSQL: memory, source and cancellation changes during lock waits block approval", async () => {
  for (const change of ["memory", "source", "cancel"] as const) {
    const f = await fixture();
    try {
      const mission = await f.create();
      const client = await f.probe.connect();
      await client.query("BEGIN");
      await client.query("SELECT value FROM relay_state WHERE id=1 FOR UPDATE");
      const controller = new AbortController();
      const pending = f.opened.service.requestDispatch(
        mission.owner,
        mission.id,
        mission.receipt!.version,
        mission.receipt!.digest,
        "revalidation-original-key",
        controller.signal,
      );
      // Install a rejection observer before releasing a cancelled operation.
      const rejection = assert.rejects(
        pending,
        (error: { code?: string }) =>
          error.code ===
          {
            memory: "memory_changed",
            source: "source_changed",
            cancel: "planning_cancelled",
          }[change],
      );
      try {
        await f.waitForLocks(1);
        if (change === "memory")
          f.opened.service.memory.set(
            mission.owner,
            "auditorium",
            "Changed during PostgreSQL lock wait",
          );
        if (change === "source")
          await client.query(
            "UPDATE relay_state SET value=jsonb_set(value, '{fixtures,revision}', to_jsonb((value #>> '{fixtures,revision}')::int + 1)) WHERE id=1",
          );
        if (change === "cancel") controller.abort();
      } finally {
        await client.query("COMMIT");
        client.release();
      }
      await rejection;
      invariant(await f.state(), 0);
    } finally {
      await f.close();
    }
  }
});
test("PostgreSQL: a deferred COMMIT failure is uncertain to the caller and exact-key retry creates one task", async () => {
  const f = await fixture();
  try {
    const mission = await f.create();
    await f.probe.query(
      "CREATE FUNCTION reject_test_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled commit failure' USING ERRCODE='40001'; END $$",
    );
    await f.probe.query(
      "CREATE CONSTRAINT TRIGGER reject_test_commit AFTER UPDATE ON relay_state DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_test_commit()",
    );
    const response = await f.approve(mission, "commit-original-key");
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(response.json().error, "storage_outcome_unknown");
    assert.ok(!response.body.includes("controlled commit failure"));
    invariant(await f.state(), 0);
    await f.probe.query("DROP TRIGGER reject_test_commit ON relay_state");
    const retried = await f.approve(mission, "commit-original-key");
    assert.equal(retried.statusCode, 200, retried.body);
    assert.equal(
      (await f.approve(mission, "commit-original-key")).json<Task>().id,
      retried.json<Task>().id,
    );
    invariant(await f.state(), 1);
  } finally {
    await f.close();
  }
});
test("PostgreSQL: duplicate declines commit once and reserve no replacement without approval", async () => {
  const f = await fixture();
  try {
    const mission = await f.create(),
      task = (await f.approve(mission)).json<Task>();
    const unlock = await f.lock();
    const pending = Array.from({ length: 4 }, () =>
      f.opened.app.inject({
        method: "POST",
        url: `/demo/tasks/${task.id}/response`,
        payload: { status: "declined", expectedRevision: task.revision },
      }),
    );
    try {
      await f.waitForLocks(2);
    } finally {
      await unlock();
    }
    const responses = await Promise.all(pending);
    responses.forEach((r) => assert.equal(r.statusCode, 200, r.body));
    const state = await f.state(),
      current = state.missions[mission.id];
    assert.equal(Object.keys(state.tasks).length, 1);
    assert.equal(current.receipt!.version, 2);
    assert.equal(current.status, "awaiting_approval");
    assert.equal(current.deadlineAt, mission.deadlineAt);
    assert.equal(
      state.fixtures.couriers.find((c) => c.id === task.courierId)!.available,
      true,
    );
    assert.notEqual(current.receipt!.selectedId, mission.receipt!.selectedId);
    assert.equal(
      state.events.filter((e) => e.type === "simulated_declined").length,
      1,
    );
    assert.equal(
      state.events.filter((e) => e.type === "simulated_offer_sent").length,
      1,
    );
    assert.ok(
      current.receipt!.changeDetails!.reasons.includes("courier_declined"),
    );
    assert.equal(
      (await f.approve(mission, "decline-old-new-key")).statusCode,
      409,
    );
  } finally {
    await f.close();
  }
});
test("PostgreSQL: acceptance/cancellation races honor revisions, and cancelled queued outbox never sends later", async () => {
  const f = await fixture();
  try {
    const mission = await f.create(),
      task = (await f.approve(mission)).json<Task>();
    const unlock = await f.lock();
    const pending = [
      f.opened.app.inject({
        method: "POST",
        url: `/demo/tasks/${task.id}/response`,
        payload: { status: "accepted", expectedRevision: task.revision },
      }),
      f.opened.app.inject({
        method: "POST",
        url: `/v1/tasks/${task.id}/cancel`,
        payload: { expectedRevision: task.revision },
      }),
    ];
    try {
      await f.waitForLocks(2);
    } finally {
      await unlock();
    }
    const responses = await Promise.all(pending);
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
    const state = await f.state(),
      current = state.tasks[task.id];
    assert.ok(["accepted", "cancelled"].includes(current.status));
    assert.equal(current.revision, task.revision! + 1);
    assert.equal(
      state.fixtures.couriers.find((c) => c.id === task.courierId)!.available,
      current.status === "cancelled",
    );
    assert.equal(
      (
        await f.opened.app.inject({
          method: "POST",
          url: `/v1/tasks/${task.id}/cancel`,
          payload: {},
        })
      ).statusCode,
      200,
    );
    const next = await f.create(),
      drain = f.opened.service.drainOutbox.bind(f.opened.service);
    f.opened.service.drainOutbox = async () => {};
    const queued = (await f.approve(next)).json<Task>();
    assert.equal(queued.status, "queued");
    assert.equal(
      (
        await f.opened.app.inject({
          method: "POST",
          url: `/v1/tasks/${queued.id}/cancel`,
          payload: {},
        })
      ).statusCode,
      200,
    );
    f.opened.service.drainOutbox = drain;
    await Promise.all([drain(), drain()]);
    await f.restart();
    const recovered = await f.state();
    assert.equal(recovered.tasks[queued.id].status, "cancelled");
    assert.equal(
      recovered.events.filter(
        (e) => e.type === "simulated_offer_sent" && e.data.taskId === queued.id,
      ).length,
      0,
    );
    assert.ok(recovered.outbox.every((o) => o.delivered));
    assert.equal(
      recovered.fixtures.couriers.find((c) => c.id === queued.courierId)!
        .available,
      true,
    );
  } finally {
    await f.close();
  }
});
test("PostgreSQL: mission history survives JSONB key ordering with chronological ties and owner filtering", async () => {
  const f = await fixture();
  try {
    const template = await f.create();
    const ids = [
      "z-test",
      "b-test",
      "a-test",
      "c-test",
      "d-test",
      "e-test",
      "f-test",
    ];
    await f.opened.service.store.transact((state) => {
      state.missions = {};
      for (const [index, id] of ids.entries())
        state.missions[id] = {
          ...structuredClone(template),
          id,
          createdAt:
            index === 0 ? "2026-10-21T01:00:00Z" : "2026-10-22T01:00:00Z",
          status: index === 3 ? "dependency_unavailable" : "completed",
        };
      state.missions["other-owner"] = {
        ...structuredClone(template),
        id: "other-owner",
        owner: { ...template.owner, user: "reviewer" },
        createdAt: "2026-10-23T01:00:00Z",
      };
    });
    assert.notDeepEqual(Object.keys((await f.state()).missions), ids);
    assert.deepEqual(
      (await f.opened.service.list(template.owner)).map((m) => m.id),
      ["a-test", "b-test", "c-test", "d-test", "e-test", "f-test", "z-test"],
    );
    const bootstrap = await f.opened.app.inject({ url: "/v1/bootstrap" });
    assert.equal(bootstrap.json().missions.length, 7);
    assert.equal(bootstrap.json().missions[2].status, "dependency_unavailable");
  } finally {
    await f.close();
  }
});
test("PostgreSQL: gateway response loss preserves trusted intent/job/outbox across JSONB and a new pool", async () => {
  const f = await fixture();
  const original = f.opened.service;
  let now = Date.parse("2026-10-22T23:00:00Z");
  const clock = () => now;
  const gateway = await gatewayFixture(original.store, clock);
  const blockedFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (
      new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      ).origin !== gateway.baseUrl
    )
      throw Error("Gateway PostgreSQL test attempted a non-fixture fetch");
    return nativeFetch(input, init);
  };
  const extra = new PostgresStore(f.url);
  const service = (store: PostgresStore) =>
    new RelayService(
      store,
      new SampleData(store, clock),
      original.generator,
      original.memory,
      original.mode,
      60,
      clock,
      new HttpGatewayExecutor(
        store,
        original.mode,
        { baseUrl: gateway.baseUrl, authorize: gateway.sign, timeoutMs: 1000 },
        clock,
      ),
    );
  try {
    const mission = await f.create(),
      key = `gateway-pg-${mission.id}`;
    const approve = (executor: RelayService) =>
      executor.requestDispatch(
        mission.owner,
        mission.id,
        mission.receipt!.version,
        mission.receipt!.digest,
        key,
      );
    gateway.loseCreateResponse();
    await assert.rejects(
      () => approve(service(original.store as PostgresStore)),
      (error: { code?: string }) => error.code === "dependency_unavailable",
    );
    const committed = await f.state(),
      task = Object.values(committed.tasks)[0];
    const intent = parseExecutionIntent(committed.executionIntents![task.id]);
    assert.equal(gateway.jobs.size, 1);
    assert.equal(task.status, "queued");
    assert.equal(committed.outbox[0].delivered, false);
    assert.deepEqual(intent.money, {
      currency: "USD",
      itemEstimateCents: 2400,
      deliveryEstimateCents: 800,
      explicitFeesCents: 0,
      approvedTotalCents: 3200,
    });
    now += 120000;
    f.advance(120000);
    const recovered = await approve(service(extra));
    assert.equal(recovered.id, task.id);
    assert.equal(recovered.execution!.intentId, intent.intentId);
    assert.equal(
      recovered.execution!.jobId,
      [...gateway.jobs.values()][0].task.jobId,
    );
    await service(extra).drainOutbox();
    const final = await f.state();
    assert.equal(Object.keys(final.tasks).length, 1);
    assert.equal(gateway.jobs.size, 1);
    assert.equal(final.outbox.length, 1);
    assert.equal(final.outbox[0].delivered, true);
    assert.equal(
      final.events.filter((e) => e.type === "gateway_state").length,
      1,
    );
    assert.equal(
      final.events.filter((e) => e.type.startsWith("simulated_")).length,
      0,
    );
    const cancellation = await service(extra).cancelTask(
      mission.owner,
      task.id,
      recovered.revision,
    );
    assert.equal(cancellation.cancellation!.confirmedAt, null);
    assert.equal(cancellation.status, "dispatch_requested");
    gateway.confirmCancellation();
    assert.equal(
      (await service(extra).getTask(mission.owner, task.id)).status,
      "cancelled",
    );
  } finally {
    globalThis.fetch = blockedFetch;
    await gateway.close();
    await extra.close();
    await f.close();
  }
});

test("PostgreSQL: real backend termination rolls back aggregate changes and the pool recovers", async () => {
  const f = await fixture();
  const store = new PostgresStore(f.url);
  try {
    await f.probe.query(
      "CREATE FUNCTION kill_test_backend() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_terminate_backend(pg_backend_pid()); RETURN NEW; END $$",
    );
    await f.probe.query(
      "CREATE TRIGGER terminate_test_write BEFORE UPDATE ON relay_state FOR EACH ROW EXECUTE FUNCTION kill_test_backend()",
    );
    let calls = 0;
    await assert.rejects(
      store.transact((state) => {
        calls++;
        state.fixtures.revision += 10;
        return null;
      }),
      (error: { code?: string }) => error.code === "storage_unavailable",
    );
    assert.equal(calls, 1, "Callback must never be automatically replayed");
    await f.probe.query("DROP TRIGGER terminate_test_write ON relay_state");
    assert.equal((await f.state()).fixtures.revision, 1);
    await store.transact((state) => {
      state.fixtures.revision++;
      return null;
    });
    assert.equal((await f.state()).fixtures.revision, 2);
  } finally {
    await store.close();
    await f.close();
  }
});
