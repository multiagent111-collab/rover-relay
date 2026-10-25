import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  mkdtemp,
  rm,
  writeFile,
  readFile,
  mkdir,
  rename,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { syncBuiltinESMExports } from "node:module";
import { MemoryAdapter } from "../src/memory.ts";
import { ownerKey } from "../src/domain.ts";
import { createApp } from "../src/app.ts";
import { configuration } from "../src/config.ts";
import { HMEM } from "../vendor/hmem/src/index.ts";
import type { Mission } from "../src/types.ts";
const identity = { tenant: "relay-demo", user: "coordinator" };
const failureResults: Record<string, unknown>[] = [];
after(async () => {
  if (process.env.RELAY_MEMORY_FAILURE_RECORD)
    await writeFile(
      process.env.RELAY_MEMORY_FAILURE_RECORD,
      JSON.stringify(
        {
          ticket: "RELAY-06",
          capturedAt: new Date().toISOString(),
          kind: "controlled corruption/I-O failure regressions in isolated temporary stores; no production files modified",
          cases: failureResults,
        },
        null,
        2,
      ) + "\n",
    );
});
const request = {
  sku: "HDMI-USB-C",
  quantity: 2,
  destination: "auditorium",
  budgetCents: 3500,
  deadlineMinutes: 30,
};
const directory = () => mkdtemp(join(tmpdir(), "relay-memory-test-"));
const scope = (root: string) =>
  join(root, "hmem", ownerKey(identity), "auditorium");
async function cleanup(path: string) {
  assert.ok(
    resolve(path).startsWith(resolve(tmpdir()) + sep) &&
      path.includes("relay-memory-test-"),
  );
  await rm(path, { recursive: true, force: true });
}
async function files(path: string) {
  return Object.fromEntries(
    await Promise.all(
      ["state.json", "ledger.jsonl", "relay-memory.json"].map(async (file) => [
        file,
        await readFile(join(path, file)).catch(() => null),
      ]),
    ),
  );
}

test("real serial process restarts prove both-role recall, corrected task terms, stale-approval rejection, forgetting and scope isolation", async () => {
  const root = await directory();
  try {
    const worker = async (phase: string, id = "") => {
      const out = await promisify(execFile)(
        process.execPath,
        ["--import", "tsx", "tests/helpers/memory-worker.ts", phase, root, id],
        { timeout: 60000, windowsHide: true },
      );
      return JSON.parse(out.stdout.trim());
    };
    const seed = await worker("seed"),
      resumed = await worker("resume", seed.missionId),
      verified = await worker("verify");
    assert.equal(new Set([seed.pid, resumed.pid, verified.pid]).size, 3);
    assert.ok(
      seed.writerClosed && resumed.writerClosed && verified.writerClosed,
    );
    assert.equal(verified.activeTasks, 0);
    if (process.env.RELAY_MEMORY_RECORD)
      await writeFile(
        process.env.RELAY_MEMORY_RECORD,
        JSON.stringify(
          {
            ticket: "RELAY-06",
            capturedAt: new Date().toISOString(),
            kind: "actual offline API/official H-MEM feature test across three serial OS processes; deterministic model substitutes; synthetic preferences",
            upstreamRevision: "1742dec56a66e58eef9dda2d2b865823758ca8cd",
            phases: [seed, resumed, verified],
            scope:
              "Isolated temporary state only. Audit retains deleted text privately; public report contains only synthetic entrances, IDs and structured action names. No live sponsor inference or production preference mutation.",
          },
          null,
          2,
        ) + "\n",
      );
  } finally {
    await cleanup(root);
  }
});

test("well-formed legacy state is adopted, unrelated factual memory is excluded and preserved by correction/forgetting", async () => {
  const root = await directory();
  try {
    const engine = new HMEM({ persistDir: scope(root) });
    const note = engine.add({
      content: "Operational stock 999; price 1 cent; always available",
      type: "factual",
      layer: "long_term",
      source: "external_snapshot",
      tags: ["entrance", "auditorium"],
    });
    const memory = new MemoryAdapter(join(root, "hmem"));
    const empty = memory.recall(identity, "auditorium");
    assert.equal(empty.entrance, null);
    assert.equal(empty.context, "");
    const saved = memory.set(identity, "auditorium", "Confirmed test door");
    assert.equal(saved.records.length, 1);
    assert.ok(!saved.context.includes("999"));
    const forgotten = memory.forget(identity, "auditorium");
    assert.equal(forgotten.context, "");
    assert.ok(new HMEM({ persistDir: scope(root) }).store.get(note.id));
    assert.throws(() => memory.recall(identity, "../../escape"), {
      code: "invalid_memory_scope",
    });
    assert.equal(
      new MemoryAdapter(join(root, "hmem")).recall(
        { ...identity, tenant: "other-tenant" },
        "auditorium",
      ).entrance,
      null,
    );
  } finally {
    await cleanup(root);
  }
});

test("forget-and-reconfirm cycles never revive an old approval even when the effective preference returns to empty", async () => {
  const root = await directory(),
    opened = await createApp({
      config: {
        ...configuration(),
        sample: true,
        databaseUrl: "",
        dataDir: root,
      },
    });
  try {
    const original = await opened.service.create(identity, request);
    opened.service.memory.set(identity, "auditorium", "Temporary test door");
    opened.service.memory.forget(identity, "auditorium");
    await assert.rejects(
      opened.service.requestDispatch(
        identity,
        original.id,
        original.receipt!.version,
        original.receipt!.digest,
        "memory-cycle-key",
      ),
      { code: "plan_replaced" },
    );
    assert.equal(
      Object.keys((await opened.service.store.read()).tasks).length,
      0,
    );
  } finally {
    await opened.app.close();
    await cleanup(root);
  }
});

test("corrupt, missing, mismatched and interrupted memory files are preserved and block new planning/approval with secret-free errors", async () => {
  const mutations: Record<string, (path: string) => Promise<void>> = {
    syntax: (path) =>
      writeFile(join(path, "state.json"), "PRIVATE CORRUPT CONTENT"),
    malformed_shape: (path) =>
      writeFile(
        join(path, "state.json"),
        JSON.stringify({ seq: 1, records: [{ id: "mem-1" }] }),
      ),
    missing_state: (path) => unlink(join(path, "state.json")),
    missing_ledger: (path) => unlink(join(path, "ledger.jsonl")),
    missing_checkpoint: (path) => unlink(join(path, "relay-memory.json")),
    missing_scope_index: (path) =>
      unlink(join(path, "..", "..", "relay-scopes.json")),
    malformed_ledger: (path) =>
      writeFile(join(path, "ledger.jsonl"), "{PRIVATE PARTIAL"),
    corrupt_checkpoint: (path) =>
      writeFile(join(path, "relay-memory.json"), "invalid"),
    stale_checkpoint: async (path) => {
      const data = JSON.parse(
        await readFile(join(path, "relay-memory.json"), "utf8"),
      );
      data.stateHash = "0".repeat(64);
      await writeFile(join(path, "relay-memory.json"), JSON.stringify(data));
    },
    non_file: async (path) => {
      await rename(join(path, "state.json"), join(path, "state-evidence.json"));
      await mkdir(join(path, "state.json"));
    },
    pending_checkpoint: (path) =>
      writeFile(join(path, ".relay-memory-test.tmp"), "interrupted"),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const root = await directory(),
      opened = await createApp({
        config: {
          ...configuration(),
          sample: true,
          databaseUrl: "",
          dataDir: root,
        },
      });
    try {
      opened.service.memory.set(
        identity,
        "auditorium",
        "Private test entrance",
      );
      const mission = await opened.service.create(identity, request),
        path = scope(root);
      await mutate(path);
      const before = await files(path);
      let modelCalls = 0;
      opened.service.generator.generate = async () => {
        modelCalls++;
        throw Error(
          "Unexpected model invocation after memory validation failure",
        );
      };
      const approval = await opened.app.inject({
        method: "POST",
        url: `/v1/missions/${mission.id}/approve`,
        payload: {
          version: mission.receipt!.version,
          digest: mission.receipt!.digest,
          idempotencyKey: `corrupt-${name}`,
        },
      });
      assert.equal(approval.statusCode, 503, name);
      assert.equal(approval.json().error, "memory_unavailable", name);
      assert.ok(
        !approval.body.includes("PRIVATE") &&
          !approval.body.includes("Private test entrance"),
        name,
      );
      const planning = await opened.app.inject({
        method: "POST",
        url: "/v1/missions",
        payload: request,
      });
      assert.equal(planning.statusCode, 503, name);
      assert.throws(
        () =>
          opened.service.memory.set(
            identity,
            "auditorium",
            "Overwrite attempt",
          ),
        { code: "memory_unavailable" },
      );
      assert.throws(
        () => opened.service.memory.forget(identity, "auditorium"),
        { code: "memory_unavailable" },
      );
      assert.deepEqual(await files(path), before, name);
      assert.equal(
        Object.keys((await opened.service.store.read()).tasks).length,
        0,
        name,
      );
      assert.equal(modelCalls, 0, name);
      assert.throws(
        () =>
          new MemoryAdapter(join(root, "hmem")).recall(identity, "auditorium"),
        { code: "memory_unavailable" },
      );
      failureResults.push({
        case: name,
        approvalStatus: approval.statusCode,
        planningStatus: planning.statusCode,
        errorCode: approval.json().error,
        modelCalls,
        tasksCreated: 0,
        filesPreserved: true,
        reopenBlocked: true,
      });
    } finally {
      await opened.app.close();
      await cleanup(root);
    }
  }
});

test("unreadable files and failed vendor writes are controlled failures; no cached preference or automatic repair follows", async () => {
  for (const mode of ["read", "write"]) {
    const root = await directory(),
      memory = new MemoryAdapter(join(root, "hmem"));
    const read = fs.readFileSync,
      write = fs.writeFileSync;
    try {
      memory.set(identity, "auditorium", "Old private test door");
      if (mode === "read") {
        fs.readFileSync = ((...args: Parameters<typeof read>) => {
          if (String(args[0]) === join(scope(root), "state.json"))
            throw Object.assign(new Error("PRIVATE access error"), {
              code: "EACCES",
            });
          return (read as Function)(...args);
        }) as typeof read;
        syncBuiltinESMExports();
      } else {
        fs.writeFileSync = ((...args: Parameters<typeof write>) => {
          if (String(args[0]) === join(scope(root), "state.json"))
            throw Object.assign(new Error("PRIVATE write error"), {
              code: "EIO",
            });
          return (write as Function)(...args);
        }) as typeof write;
      }
      assert.throws(
        () =>
          mode === "read"
            ? memory.recall(identity, "auditorium")
            : memory.set(identity, "auditorium", "New test door"),
        { code: "memory_unavailable" },
      );
      fs.readFileSync = read;
      fs.writeFileSync = write;
      syncBuiltinESMExports();
      const evidence = await files(scope(root));
      assert.throws(() => memory.recall(identity, "auditorium"), {
        code: "memory_unavailable",
      });
      if (mode === "write")
        assert.throws(
          () =>
            new MemoryAdapter(join(root, "hmem")).recall(
              identity,
              "auditorium",
            ),
          { code: "memory_unavailable" },
        );
      assert.deepEqual(await files(scope(root)), evidence);
      failureResults.push({
        case: `injected_${mode}_failure`,
        errorCode: "memory_unavailable",
        filesPreservedAfterFailure: true,
        cachedPreferenceBlocked: true,
        reopenBlocked: mode === "write",
      });
    } finally {
      fs.readFileSync = read;
      fs.writeFileSync = write;
      syncBuiltinESMExports();
      await cleanup(root);
    }
  }
});

test("namespace loss and inconsistent legacy pairs are not interpreted as first-use empty memory", async () => {
  const root = await directory();
  try {
    const memory = new MemoryAdapter(join(root, "hmem"));
    memory.set(identity, "auditorium", "Existing test door");
    await rename(scope(root), scope(root) + "-preserved");
    assert.throws(
      () =>
        new MemoryAdapter(join(root, "hmem")).recall(identity, "auditorium"),
      { code: "memory_unavailable" },
    );
    assert.ok(!fs.existsSync(scope(root)));
    const legacy = join(root, "legacy"),
      engine = new HMEM({
        persistDir: join(legacy, ownerKey(identity), "auditorium"),
      });
    engine.add({
      content: "Delivery entrance preference: Legacy test door",
      type: "preference",
      source: "user_confirmed",
      layer: "long_term",
      tags: ["entrance", "auditorium"],
      confidence: 1,
      provenance: {
        origin: "user_correction",
        learnedAt: Date.now(),
        label: "Explicit entrance confirmation",
      },
    });
    await writeFile(
      join(legacy, ownerKey(identity), "auditorium", "state.json"),
      JSON.stringify({ seq: 0, records: [] }),
    );
    assert.throws(
      () => new MemoryAdapter(legacy).recall(identity, "auditorium"),
      { code: "memory_unavailable" },
    );
  } finally {
    await cleanup(root);
  }
});
