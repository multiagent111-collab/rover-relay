import assert from "node:assert/strict";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createApp } from "../../src/app.ts";
import { configuration } from "../../src/config.ts";
import { hash } from "../../src/domain.ts";
import type { Mission } from "../../src/types.ts";

const input = {
  sku: "HDMI-USB-C",
  quantity: 2,
  destination: "auditorium",
  budgetCents: 3500,
  deadlineMinutes: 30,
};
const owner = { tenant: "relay-demo", user: "coordinator" };
const cases: Record<string, unknown>[] = [];
let externalAttempts = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  externalAttempts++;
  throw Error("Measured sample cannot call external services");
};
try {
  for (const name of [
    "canonical",
    "clarification",
    "budget",
    "deadline",
    "stock",
    "route",
    "memory",
  ]) {
    const started = performance.now(),
      directory = await mkdtemp(join(tmpdir(), "relay-evaluation-sample-"));
    const clock = () => Date.parse("2026-10-22T23:00:00Z");
    const opened = await createApp({
      config: {
        ...configuration(),
        sample: true,
        demo: true,
        databaseUrl: "",
        dataDir: directory,
      },
      clock,
    });
    const service = opened.service,
      baseline = structuredClone((await service.store.read()).fixtures);
    let generators = 0,
      snapshots = 0;
    const generate = service.generator.generate.bind(service.generator),
      snapshot = service.data.snapshot.bind(service.data);
    const modelInputs: {
      role: string;
      memoryIds: string[];
      entrance: string | null;
    }[] = [];
    service.generator.generate = async (role, request, signal) => {
      generators++;
      modelInputs.push({
        role,
        memoryIds: request.memory.records.map((r) => r.id),
        entrance: request.memory.entrance,
      });
      return generate(role, request, signal);
    };
    service.data.snapshot = async (...args) => {
      snapshots++;
      return snapshot(...args);
    };
    const record: Record<string, unknown> = {
      name,
      mode: "offline_sample",
      data: "seedFixtures",
      inference: "deterministic substitute; no model HTTP",
      execution: "simulator",
      result: "fail",
    };
    const approve = (mission: Mission) =>
      service.requestDispatch(
        owner,
        mission.id,
        mission.receipt!.version,
        mission.receipt!.digest,
        `evaluation-${mission.id}-${mission.receipt!.version}`,
      );
    const receipts: Record<string, unknown>[] = [];
    const capture = (mission: Mission) => {
      const r = mission.receipt!;
      receipts.push({
        missionId: mission.id,
        deadlineAt: mission.deadlineAt,
        version: r.version,
        digest: r.digest,
        selectedId: r.selectedId,
        sourceFingerprint: r.sourceFingerprint,
        memoryRevision: r.memoryRevision,
        memoryRecordIds: r.memory.records.map((m) => m.id),
        queryIds: [
          ...new Set(r.evidence.map((e) => e.queryId).filter(Boolean)),
        ],
        evidenceIds: r.evidence.map((e) => e.id),
        alternatives: r.alternatives,
        terms: r.review?.terms,
        steps: r.steps,
        coordination: r.coordination,
      });
    };
    try {
      if (name === "clarification") {
        const intake = await service.createIntake(owner, {
          text: "Need two HDMI adapters to the auditorium",
        });
        assert.ok(intake.questions.some((q) => q.field === "budgetCents"));
        assert.ok(intake.questions.some((q) => q.field === "deadlineMinutes"));
        assert.equal(generators, 0);
        assert.equal(snapshots, 0);
        record.intake = {
          id: intake.id,
          status: intake.status,
          questions: intake.questions,
        };
      } else if (name === "memory") {
        service.memory.set(owner, "auditorium", "Evaluation north entrance");
        const first = await service.create(owner, input);
        capture(first);
        assert.ok(
          modelInputs.every((i) => i.entrance === "Evaluation north entrance"),
        );
        service.memory.set(owner, "auditorium", "Evaluation south entrance");
        await assert.rejects(
          () => approve(first),
          (e: { code: string }) => e.code === "plan_replaced",
        );
        const corrected = await service.get(owner, first.id);
        capture(corrected);
        const task = await approve(corrected);
        assert.equal(task.entrance, "Evaluation south entrance");
        record.task = {
          id: task.id,
          approvedVersion: task.planVersion,
          intentId: task.execution?.intentId,
          status: task.status,
          entrance: task.entrance,
        };
        await service.cancelTask(owner, task.id);
        service.memory.forget(owner, "auditorium");
        assert.equal(service.memory.recall(owner, "auditorium").entrance, null);
        const forgotten = await service.create(owner, input);
        capture(forgotten);
        assert.equal(forgotten.receipt!.memory.entrance, null);
      } else {
        const request = {
          ...input,
          ...(name === "budget" ? { budgetCents: 3000 } : {}),
          ...(name === "deadline"
            ? { budgetCents: 3000, deadlineMinutes: 10 }
            : {}),
        };
        const mission = await service.create(owner, request);
        capture(mission);
        if (name === "canonical") {
          assert.equal(mission.receipt!.review!.terms.totalCents, 3200);
          const tasks = await Promise.all(
            Array.from({ length: 4 }, () => approve(mission)),
          );
          assert.equal(new Set(tasks.map((t) => t.id)).size, 1);
          const task = tasks[0],
            state = await service.store.read();
          assert.equal(state.outbox.length, 1);
          assert.ok(state.outbox[0].delivered);
          record.task = {
            id: task.id,
            status: task.status,
            approvedVersion: task.planVersion,
            planDigest: task.planDigest,
            intentId: task.execution?.intentId,
            jobId: null,
          };
          record.outbox = {
            id: state.outbox[0].id,
            messages: 1,
            offerEvents: state.events.filter(
              (e) => e.type === "simulated_offer_sent",
            ).length,
          };
          await service.cancelTask(owner, task.id);
        } else if (name === "budget") {
          assert.equal(mission.receipt!.selectedId, null);
          assert.equal(mission.receipt!.alternatives.budgetIncreaseCents, 200);
        } else if (name === "deadline") {
          assert.equal(mission.receipt!.selectedId, null);
          assert.equal(
            mission.receipt!.alternatives.status,
            "combined_change_required",
          );
        } else {
          await service.store.transact((state) => {
            if (name === "stock") {
              state.fixtures.suppliers[0].stock = 0;
              state.fixtures.suppliers[0].version++;
            } else
              state.fixtures.edges.find((e) => e.id === "E4")!.closed = true;
            state.fixtures.revision++;
          });
          await assert.rejects(
            () => approve(mission),
            (e: { code: string }) => e.code === "plan_replaced",
          );
          const replacement = await service.get(owner, mission.id);
          capture(replacement);
          assert.equal(replacement.receipt!.version, 2);
          assert.equal(
            Object.keys((await service.store.read()).tasks).length,
            0,
          );
          record.oldApproval = {
            result: "rejected",
            code: "plan_replaced",
            freshConfirmationRequired: true,
          };
        }
      }
      record.result = "pass";
    } catch {
      record.errorCode = "scenario_assertion_failed";
    } finally {
      // Explicitly restore semantic fixture/preference state, then remove only
      // this isolated directory. No demo/live data or source is mutated.
      try {
        assert.ok(
          Object.values((await service.store.read()).tasks).every((t) =>
            ["cancelled", "declined", "completed"].includes(t.status),
          ),
        );
        await service.store.transact((state) => {
          state.fixtures = structuredClone(baseline);
        });
        service.memory.forget(owner, "auditorium");
        assert.equal(
          hash((await service.store.read()).fixtures),
          hash(baseline),
        );
        assert.equal(service.memory.recall(owner, "auditorium").entrance, null);
        record.mutationsRestored = true;
      } catch {
        record.result = "fail";
        record.mutationsRestored = false;
      }
      await opened.app.close();
      const actual = await realpath(directory),
        parent = await realpath(tmpdir());
      assert.equal(dirname(actual).toLowerCase(), parent.toLowerCase());
      assert.ok(
        actual.split(/[\\/]/).at(-1)!.startsWith("relay-evaluation-sample-"),
      );
      await rm(actual, { recursive: true, force: true });
      record.temporaryStateRemoved = true;
    }
    Object.assign(record, {
      durationMs: Math.round(performance.now() - started),
      calls: {
        generatorInvocations: generators,
        dataSnapshotInvocations: snapshots,
        modelHttpRequests: 0,
      },
      modelInputs,
      receipts,
    });
    cases.push(record);
  }
} finally {
  globalThis.fetch = originalFetch;
}
const report = {
  kind: "measured_sample",
  capturedAt: new Date().toISOString(),
  seed: "seedFixtures revision 1; fixed scenario order; UUIDs and H-MEM store IDs are random",
  clock: "Fixed 2026-10-22T23:00:00Z; durations use wall-clock performance.now",
  result:
    cases.every((c) => c.result === "pass") && externalAttempts === 0
      ? "pass"
      : "fail",
  externalAttempts,
  cases,
};
console.log(JSON.stringify(report));
if (report.result !== "pass") process.exitCode = 1;
