import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { dirname, join, resolve, sep } from "node:path";
import { reviewPublic } from "./public-review.ts";

// Export current candidate bytes, including reviewed uncommitted/new source.
// Never load .env or copy credentials, runtime state, Git history or private helpers.
const args = process.argv.slice(2);
if (args.some((a) => a !== "--offline") || args.length > 1)
  throw Error("Usage: npm run verify:setup -- [--offline]");
const root = process.cwd(),
  startedAt = new Date().toISOString();
const source = reviewPublic(root);
assert.equal(
  source.result,
  "pass",
  "Public source review must pass before exporting",
);
const temporary = await mkdtemp(join(tmpdir(), "relay-judge-setup-"));
const clean = join(temporary, "source");
await mkdir(clean);
const port = await new Promise<number>((accept, reject) => {
  const listener = createServer();
  listener.once("error", reject);
  listener.listen(0, "127.0.0.1", () => {
    const address = listener.address();
    if (!address || typeof address === "string")
      return reject(Error("No sample port"));
    listener.close((error) => (error ? reject(error) : accept(address.port)));
  });
});
const env: NodeJS.ProcessEnv = {};
for (const [key, value] of Object.entries(process.env))
  if (
    /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|HOME|NPM_CONFIG_CACHE)$/i.test(
      key,
    )
  )
    env[key] = value;
env.SAMPLE_MODE = "true";
env.DATABASE_URL = "";
const phases: {
  name: string;
  result: string;
  durationMs: number;
  records: unknown[];
}[] = [];
async function run(name: string, argv: string[], npm = false) {
  const start = performance.now();
  const command = npm
    ? process.platform === "win32"
      ? process.env.ComSpec || "cmd.exe"
      : "npm"
    : process.execPath;
  const parameters =
    npm && process.platform === "win32"
      ? ["/d", "/s", "/c", "npm.cmd", ...argv]
      : argv;
  const outcome = await new Promise<{ code: number | null; stdout: string }>(
    (done) => {
      const child = spawn(command, parameters, {
        cwd: clean,
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        if (stdout.length < 2 * 1024 * 1024) stdout += chunk.toString();
      });
      child.stderr.resume(); // Raw errors/logs are deliberately not public evidence.
      const timer = setTimeout(() => child.kill(), 240000);
      child.once("error", () => {
        clearTimeout(timer);
        done({ code: null, stdout: "" });
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        done({ code, stdout });
      });
    },
  );
  const records = outcome.stdout.split(/\r?\n/).flatMap((line) => {
    try {
      const value = JSON.parse(line);
      return ["judge_http", "measured_sample"].includes(value.kind)
        ? [value]
        : [];
    } catch {
      return [];
    }
  });
  if (name.startsWith("Documented managed") && outcome.code === 0) {
    const start = outcome.stdout.search(/\{\r?\n\s*"checkedAt"/);
    const parsed = JSON.parse(outcome.stdout.slice(start));
    assert.equal(parsed.results.length, 1);
    const service = parsed.results[0];
    if (name.endsWith("stop")) assert.equal(service.status, "stopped");
    else {
      assert.equal(service.reachable, true);
      assert.equal(service.managed, true);
      assert.equal(service.configurationMatches, true);
      assert.equal(service.mode, "offline_sample");
    }
    records.push({
      kind: "managed_sample",
      action: parsed.action,
      checkedAt: parsed.checkedAt,
      service: service.service,
      mode: service.mode || "offline_sample",
      reachable: service.reachable ?? null,
      managed: service.managed ?? null,
      status: service.status || "running",
    });
  }
  phases.push({
    name,
    result: outcome.code === 0 ? "pass" : "fail",
    durationMs: Math.round(performance.now() - start),
    records,
  });
  console.log(`${name}: ${outcome.code === 0 ? "PASS" : "FAIL"}`);
  assert.equal(
    outcome.code,
    0,
    `${name} failed; no raw credentials/logs emitted`,
  );
  if (name === "HTTP workflow")
    assert.ok(
      records.some((r) => r.kind === "judge_http" && r.result === "pass"),
    );
  if (name === "Memory and disruption scenarios")
    assert.ok(
      records.some((r) => r.kind === "measured_sample" && r.result === "pass"),
    );
}
let passed = false,
  temporaryRemoved = false;
let managedAttempted = false;
const localFlags = [
  "--sample",
  "--service=relay",
  `--port=${port}`,
  "--data-dir=.data/judge-managed",
];
try {
  for (const file of source.files) {
    if (file.path.startsWith("examples/recorded/")) continue;
    const target = resolve(clean, file.path);
    assert.ok(target.startsWith(clean + sep));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, file.path), target);
  }
  await run(
    "Locked dependency install",
    [
      "ci",
      "--ignore-scripts",
      ...(args.includes("--offline") ? ["--offline"] : []),
    ],
    true,
  );
  await run("Production build", ["run", "build"], true);
  await run("Pinned H-MEM integrity and conformance", [
    "scripts/verify-hmem.mjs",
  ]);
  await run("HTTP workflow", ["--import", "tsx", "scripts/judge-smoke.ts"]);
  await run("Memory and disruption scenarios", [
    "--import",
    "tsx",
    "scripts/evaluation/sample.ts",
  ]);
  managedAttempted = true;
  try {
    await run(
      "Documented managed start",
      ["run", "local", "--", "start", ...localFlags],
      true,
    );
    await run(
      "Documented managed status",
      ["run", "local", "--", "status", ...localFlags],
      true,
    );
  } finally {
    await run(
      "Documented managed stop",
      ["run", "local", "--", "stop", ...localFlags],
      true,
    );
    managedAttempted = false;
  }
  const final = reviewPublic(root);
  assert.deepEqual(
    final.files,
    source.files,
    "Source changed during clean setup verification",
  );
  passed = true;
} finally {
  // If graceful shutdown fails, retain the owned export/data for diagnosis.
  assert.equal(
    managedAttempted,
    false,
    "Managed sample stop failed; temporary source preserved",
  );
  const actual = await realpath(temporary);
  assert.ok(
    actual.startsWith((await realpath(tmpdir())) + sep) &&
      actual.split(/[\\/]/).at(-1)!.startsWith("relay-judge-setup-"),
  );
  await rm(actual, { recursive: true, force: true });
  temporaryRemoved = true;
  const output = join(root, ".data", "judge", `relay-12-${randomUUID()}.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        schemaVersion: "1.0",
        ticket: "RELAY-12",
        startedAt,
        completedAt: new Date().toISOString(),
        runtime: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
        },
        result: passed ? "pass" : "fail",
        dependencyInstall: args.includes("--offline")
          ? "locked local cache; no registry call"
          : "locked npm registry install; sample runtime offline",
        mode: "clean_current_source_offline_sample",
        sourceFiles: source.files,
        exportExclusions: [
          "examples/recorded/ (dated evidence, not executable setup source)",
          "ignored credentials, runtime state, dependencies and Git history",
        ],
        phases,
        temporaryRemoved,
        sampleCredentialsLoaded: false,
        privateCheckoutRequired: false,
        serviceCallsAuthorized: false,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(`Judge setup report: ${output}`);
}
