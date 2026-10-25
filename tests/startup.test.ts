import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { createApp } from "../src/app.ts";
import { configuration } from "../src/config.ts";
import { acquireWriterLock } from "../src/lifecycle.ts";
import { Readiness } from "../src/readiness.ts";
import { RelayError } from "../src/types.ts";
import { runPreflight } from "../src/preflight.ts";

function environment(values: Record<string, string>) {
  const old = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  return () => {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
async function temporary() {
  return mkdtemp(join(tmpdir(), "relay-startup-"));
}
async function cleanup(directory: string) {
  const absolute = resolve(directory);
  if (
    !absolute.startsWith(resolve(tmpdir()) + sep) ||
    !basename(absolute).startsWith("relay-startup-")
  )
    throw new Error("Unsafe test cleanup target");
  await rm(absolute, { recursive: true, force: true });
}
function sample(dataDir: string) {
  return { ...configuration(), sample: true, databaseUrl: "", dataDir };
}
async function port() {
  const server = createServer();
  await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
  const value = (server.address() as { port: number }).port;
  await new Promise<void>((accept) => server.close(() => accept()));
  return value;
}
function command(args: string[], env = process.env) {
  return new Promise<{ code: number | null; output: string }>(
    (accept, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", ...args], {
        cwd: process.cwd(),
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (bytes) => (output += bytes));
      child.stderr.on("data", (bytes) => (output += bytes));
      child.once("error", reject);
      child.once("exit", (code) => accept({ code, output }));
    },
  );
}

test("invalid mode and out-of-range port cannot silently start another configuration", () => {
  const cases: Record<string, string>[] = [
    { SAMPLE_MODE: "tru" },
    { DEMO_MODE: "yes" },
    { PORT: "65536" },
  ];
  for (const values of cases) {
    const restore = environment(values);
    try {
      assert.throws(configuration);
    } finally {
      restore();
    }
  }
});

test("writer lock excludes another process, preserves stale locks and resolves path aliases", async () => {
  const directory = await temporary();
  const lock = acquireWriterLock(directory);
  try {
    const result = await command([
      "--eval",
      `import { acquireWriterLock } from './src/lifecycle.ts'; try { acquireWriterLock(${JSON.stringify(join(directory, "child", ".."))}); process.exit(2); } catch(e) { if(e.code==='writer_locked') process.exit(0); throw e; }`,
    ]);
    assert.equal(result.code, 0, result.output);
    assert.throws(() => acquireWriterLock(directory), {
      code: "writer_locked",
    });
    lock.release();
    await writeFile(
      join(directory, ".relay-writer.lock"),
      JSON.stringify({ pid: 2147483647, instanceId: "stale" }),
    );
    assert.throws(() => acquireWriterLock(directory), {
      code: "writer_locked",
    });
    assert.equal(
      JSON.parse(await readFile(join(directory, ".relay-writer.lock"), "utf8"))
        .instanceId,
      "stale",
    );
  } finally {
    await cleanup(directory);
  }
});

test("second app on another port cannot write the same H-MEM; graceful close permits persistent restart", async () => {
  const directory = await temporary();
  let opened: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    opened = await createApp({ config: sample(directory) });
    await opened.app.inject({
      method: "PUT",
      url: "/v1/preferences/entrance",
      payload: { venue: "auditorium", entrance: "East service door" },
    });
    await assert.rejects(
      createApp({ config: { ...sample(directory), port: 4999 } }),
      { code: "writer_locked" },
    );
    await opened.app.close();
    opened = await createApp({ config: sample(directory) });
    const recalled = await opened.app.inject({
      url: "/v1/preferences/entrance?venue=auditorium",
    });
    assert.equal(recalled.json().entrance, "East service door");
  } finally {
    await opened?.app.close();
    await cleanup(directory);
  }
});

test("occupied ports fail before store initialization and never print credential-bearing errors", async () => {
  const directory = await temporary();
  const occupied = createServer();
  await new Promise<void>((accept) => occupied.listen(0, "127.0.0.1", accept));
  try {
    const dataDir = join(directory, "must-not-be-created");
    const result = await command(["src/server.ts"], {
      ...process.env,
      SAMPLE_MODE: "true",
      DATABASE_URL: "",
      DATA_DIR: dataDir,
      HOST: "127.0.0.1",
      PORT: String((occupied.address() as { port: number }).port),
      NVIDIA_API_KEY: "sensitive-test-value",
    });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /port_unavailable/);
    assert.ok(!result.output.includes("sensitive-test-value"));
    assert.ok(!existsSync(dataDir));
  } finally {
    await new Promise<void>((accept) => occupied.close(() => accept()));
    await cleanup(directory);
  }
});

test("passive readiness is authenticated, secret-free, and does not promote configured keys to verified calls", async () => {
  const directory = await temporary();
  const restore = environment({
    RELAY_INFERENCE_PROVIDER: "nvidia",
    NVIDIA_API_KEY: "private-readiness-test",
    NEMOTRON_MODEL: "nvidia/nemotron-3.5-lightning-30b-a3b",
    ZETARIS_REST_URL: "http://not-contacted.invalid",
    ZETARIS_API_KEY: "private-zetaris-test",
    ZETARIS_ORG_ID: "1",
  });
  const original = globalThis.fetch;
  let opened: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    globalThis.fetch = async () => {
      assert.fail("Passive readiness called a sponsor");
    };
    opened = await createApp({
      config: {
        ...sample(directory),
        sample: false,
        accessToken: "local-test-token-at-least-24-characters",
      },
    });
    assert.equal(
      (await opened.app.inject({ url: "/v1/readiness" })).statusCode,
      401,
    );
    const response = await opened.app.inject({
      url: "/v1/readiness",
      headers: {
        authorization: "Bearer local-test-token-at-least-24-characters",
      },
    });
    assert.equal(response.statusCode, 200);
    const readiness = response.json();
    assert.equal(readiness.inference.provider, "nvidia-direct");
    assert.equal(readiness.inference.configured, true);
    assert.equal(readiness.inference.reachable, null);
    assert.equal(readiness.inference.authenticated, null);
    assert.equal(readiness.inference.lastExercisedAt, null);
    assert.equal(readiness.data.lastExercisedAt, null);
    assert.ok(
      !response.body.includes("private-readiness-test") &&
        !response.body.includes("private-zetaris-test"),
    );
    const health = (await opened.app.inject({ url: "/v1/health" })).json();
    assert.equal(health.sponsorCallsVerified, false);
    assert.equal(health.readinessUrl, "/v1/readiness");
  } finally {
    globalThis.fetch = original;
    await opened?.app.close();
    restore();
    await cleanup(directory);
  }
});

test("actual adapter observations preserve last success, distinguish authentication failure and do not invent model identity", async () => {
  const restore = environment({
    RELAY_INFERENCE_PROVIDER: "nightshift",
    METERLESS_BASE_URL: "http://not-contacted.invalid",
    METERLESS_RUNTIME_TOKEN: "private-test-key",
    METERLESS_ROUTE: "meterless/fast",
    NEMOTRON_MODEL: "nvidia/nemotron-3.5-lightning-30b-a3b",
  });
  let now = Date.parse("2026-10-22T20:00:00Z");
  try {
    const readiness = new Readiness(
      { ...sample("unused"), sample: false },
      () => now,
    );
    let rejected = false;
    const generator = readiness.generator({
      generate: async () => {
        if (rejected)
          throw new RelayError(
            503,
            "nightshift_unauthorized",
            "untrusted private raw error",
          );
        return {
          provider: "meterless-nightshift",
          model: "meterless/fast",
          value: {},
        };
      },
    });
    await generator.generate("Planner", {} as never, AbortSignal.timeout(1000));
    const exercisedAt = readiness.snapshot().inference.lastExercisedAt;
    assert.equal(
      readiness.snapshot().inference.reportedModel,
      "meterless/fast",
    );
    assert.equal(readiness.snapshot().inference.authenticated, true);
    rejected = true;
    now += 1000;
    await assert.rejects(
      generator.generate("Critic", {} as never, AbortSignal.timeout(1000)),
    );
    const failed = readiness.snapshot();
    assert.equal(failed.inference.reachable, true);
    assert.equal(failed.inference.authenticated, false);
    assert.equal(failed.inference.lastExercisedAt, exercisedAt);
    assert.equal(failed.inference.errorCode, "nightshift_unauthorized");
    assert.ok(!JSON.stringify(failed).includes("untrusted private raw error"));
    assert.equal(failed.data.reachable, null);
  } finally {
    restore();
  }
});

test("plain preflight stays offline even when private configuration selects live mode", async () => {
  const result = await command(["scripts/preflight.ts", "--json"], {
    ...process.env,
    SAMPLE_MODE: "false",
    RELAY_INFERENCE_PROVIDER: "bad-provider",
  });
  assert.equal(result.code, 0, result.output);
  const report = JSON.parse(result.output);
  assert.equal(report.live, false);
  assert.ok(
    report.results.some(
      (row: { name: string; status: string }) =>
        row.name.startsWith("H-MEM") && row.status === "PASS",
    ),
  );
  assert.ok(
    report.results.every(
      (row: { checkedAt: string }) => !!Date.parse(row.checkedAt),
    ),
  );
});

test("independent preflight failure states include time and authentication without raw upstream text", async () => {
  const restore = environment({
    RELAY_INFERENCE_PROVIDER: "nvidia",
    NVIDIA_API_KEY: "",
    NEMOTRON_MODEL: "nvidia/nemotron-3.5-lightning-30b-a3b",
    ZETARIS_REST_URL: "http://zetaris.invalid",
    ZETARIS_API_KEY: "test",
    ZETARIS_ORG_ID: "1",
  });
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("sensitive upstream body", { status: 401 });
    const results = await runPreflight({ live: true });
    assert.equal(
      results.find((row) => row.name === "Inference")?.configured,
      false,
    );
    const denied = results.find(
      (row) => row.name === "Zetaris authenticated SQL",
    )!;
    assert.equal(denied.reachable, true);
    assert.equal(denied.authenticated, false);
    assert.equal(denied.provider, "zetaris");
    assert.equal(denied.lastExercisedAt, null);
    assert.ok(Date.parse(denied.checkedAt));
    assert.ok(!JSON.stringify(results).includes("sensitive upstream body"));
  } finally {
    restore();
    globalThis.fetch = original;
  }
});

test(
  "managed sample start is idempotent, stop preserves data and restart retains H-MEM for both services",
  { timeout: 90000 },
  async () => {
    const directory = await temporary();
    const relayPort = await port();
    const supplierPort = await port();
    const flags = [
      "--sample",
      `--port=${relayPort}`,
      `--supplier-port=${supplierPort}`,
      `--data-dir=${directory}`,
    ];
    const local = (action: string) =>
      command(["scripts/local.ts", action, ...flags]);
    try {
      let result = await local("start");
      assert.equal(result.code, 0, result.output);
      const first = await (
        await fetch(`http://127.0.0.1:${relayPort}/v1/health`)
      ).json();
      assert.equal((await local("start")).code, 0);
      const deniedStop = await fetch(
        `http://127.0.0.1:${relayPort}/internal/local/stop`,
        {
          method: "POST",
          headers: { "x-relay-local-control": "wrong-local-capability" },
        },
      );
      assert.equal(deniedStop.status, 404);
      assert.equal(
        (await (await fetch(`http://127.0.0.1:${relayPort}/v1/health`)).json())
          .instanceId,
        first.instanceId,
      );
      await fetch(`http://127.0.0.1:${relayPort}/v1/preferences/entrance`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          venue: "auditorium",
          entrance: "Managed east door",
        }),
      });
      const stopped = await local("stop");
      assert.equal(stopped.code, 0, stopped.output);
      assert.ok(
        JSON.parse(stopped.output).results.every(
          (row: { status: string }) => row.status === "stopped",
        ),
      );
      assert.ok(!existsSync(join(directory, ".relay-writer.lock")));
      result = await local("start");
      assert.equal(result.code, 0, result.output);
      const preference = await (
        await fetch(
          `http://127.0.0.1:${relayPort}/v1/preferences/entrance?venue=auditorium`,
        )
      ).json();
      assert.equal(preference.entrance, "Managed east door");
      const inventory = await (
        await fetch(`http://127.0.0.1:${supplierPort}/inventory`)
      ).json();
      assert.ok(inventory.data.length > 0);
    } finally {
      const finalStop = await local("stop");
      if (
        finalStop.code !== 0 ||
        existsSync(join(directory, ".relay-writer.lock")) ||
        existsSync(join(directory, "supplier/.supplier-writer.lock"))
      )
        throw new Error(
          "Test services did not release their locks; temporary data preserved for diagnosis.",
        );
      await cleanup(directory);
    }
  },
);
