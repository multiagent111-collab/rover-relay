import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, sep } from "node:path";
import pg from "pg";

// Explicit integration command. Never accepts a database URL or a live volume.
const run = promisify(execFile);
const evaluation = process.argv.slice(2).includes("--report=json");
if (process.argv.slice(2).some((arg) => arg !== "--report=json"))
  throw Error(
    "Use test:postgres [--report=json]; no database override is accepted.",
  );
const token = randomUUID();
const name = `relay-pg-test-${token}`;
const directory = await mkdtemp(join(tmpdir(), "relay-pg-test-"));
const password = randomBytes(32).toString("hex");
let container = "";
let pool: pg.Pool | undefined;
let failed = false;
const docker = async (...args: string[]) =>
  (
    await run("docker", args, {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, POSTGRES_PASSWORD: password },
    })
  ).stdout.trim();
try {
  const version = await docker("version", "--format", "{{.Server.Version}}");
  container = await docker(
    "create",
    "--pull=never",
    "--name",
    name,
    "--label",
    `relay.test-run=${token}`,
    "--publish",
    "127.0.0.1::5432",
    "--tmpfs",
    "/var/lib/postgresql/data:rw",
    "--env",
    "POSTGRES_PASSWORD",
    "--env",
    "POSTGRES_DB=relay_test",
    "postgres:16-alpine",
  );
  if (!/^[a-f0-9]{64}$/.test(container))
    throw Error("Invalid test container ID");
  await docker("start", container);
  const binding = JSON.parse(
    await docker(
      "inspect",
      "--format",
      "{{json .NetworkSettings.Ports}}",
      container,
    ),
  )["5432/tcp"];
  if (binding?.length !== 1 || binding[0].HostIp !== "127.0.0.1")
    throw Error("Test port is not isolated on loopback");
  const url = new URL(
    `postgresql://postgres@127.0.0.1:${binding[0].HostPort}/relay_test`,
  );
  url.password = password;
  pool = new pg.Pool({
    connectionString: url.href,
    connectionTimeoutMillis: 500,
  });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      await pool.query("SELECT 1");
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!ready) throw Error("Temporary PostgreSQL did not become ready");
  const database = (await pool.query("SHOW server_version")).rows[0]
    .server_version;
  console.log(
    JSON.stringify({
      mode: "offline_sample",
      operations: "simulated",
      node: process.version,
      docker: version,
      postgresql: database,
      image: "postgres:16-alpine",
      container: name,
      imageId: await docker("inspect", "--format", "{{.Image}}", container),
      storage: "disposable tmpfs",
      host: "127.0.0.1",
      port: Number(binding[0].HostPort),
    }),
  );
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--test",
        ...(evaluation
          ? ["--test-reporter=./scripts/evaluation/reporter.mjs"]
          : []),
        "tests/postgres.integration.ts",
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          RELAY_PG_TEST_URL: url.href,
          RELAY_PG_TEST_RUN: token,
          RELAY_PG_TEST_DIR: directory,
        },
      },
    );
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw Error("PostgreSQL integration checks failed");
} catch {
  failed = true;
  // Do not print child-process errors: they can embed environment/connection URLs.
  console.error(
    "PostgreSQL verification failed. Check Docker access, the cached postgres:16-alpine image and test assertions.",
  );
} finally {
  await pool?.end();
  try {
    if (container) {
      const owner = await docker(
        "inspect",
        "--format",
        '{{index .Config.Labels "relay.test-run"}}',
        container,
      );
      const exact = await docker("inspect", "--format", "{{.Id}}", container);
      if (owner !== token || exact !== container)
        throw Error("Test ownership mismatch; refusing cleanup");
      await docker("rm", "--force", "--volumes", container);
    }
    const actual = await realpath(directory);
    const parent = await realpath(tmpdir());
    if (
      dirname(actual).toLowerCase() !== parent.toLowerCase() ||
      !actual
        .toLowerCase()
        .startsWith(parent.toLowerCase() + sep + "relay-pg-test-")
    )
      throw Error("Unsafe test directory cleanup");
    await rm(actual, { recursive: true, force: true });
    console.log(
      "Verified test-owned container, temporary storage and H-MEM directories removed.",
    );
  } catch {
    failed = true;
    console.error(
      "Test cleanup failed or ownership changed; retained resources for inspection.",
    );
  }
}
if (failed) process.exitCode = 1;
