import { spawn, execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { configuration, loadEnvironment } from "../src/config.ts";
import { configurationId } from "../src/readiness.ts";
import {
  assertPortAvailable,
  supplierSettings,
  supplierConfigurationId,
} from "../src/lifecycle.ts";

const args = process.argv.slice(2);
const action = args.shift() || "status";
const allowed =
  /^(?:--sample|--json|--system-ca|--service=(?:relay|supplier|postgres|all)|--port=\d+|--supplier-port=\d+|--data-dir=.+)$/;
if (
  !["start", "stop", "status"].includes(action) ||
  args.some((arg) => !allowed.test(arg))
) {
  console.error(
    "Usage: npm run local -- start|status|stop [--service=relay|supplier|postgres|all] [--sample] [--system-ca] [--port=4183] [--supplier-port=4184] [--data-dir=.data/test] [--json]",
  );
  process.exit(2);
}
const option = (name: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const delay = (ms: number) => new Promise((accept) => setTimeout(accept, ms));
loadEnvironment();
if (args.includes("--sample")) {
  process.env.SAMPLE_MODE = "true";
  process.env.DATABASE_URL = "";
  process.env.DATA_DIR = option("data-dir") || ".data/sample";
  process.env.SUPPLIER_DATA_FILE = join(
    process.env.DATA_DIR,
    "supplier/inventory.sqlite",
  );
}
if (option("port")) process.env.PORT = option("port");
if (option("supplier-port"))
  process.env.SUPPLIER_PORT = option("supplier-port");
if (option("data-dir")) process.env.DATA_DIR = option("data-dir");

type Role = "relay" | "supplier";
type Health = {
  status?: string;
  project?: string;
  instanceId?: string;
  launchId?: string;
  configurationId?: string;
  mode?: string;
  readinessUrl?: string;
};
type Record = {
  pid: number;
  launchId: string;
  instanceId?: string;
  token: string;
};
const localHost = (host: string) => {
  if (!["127.0.0.1", "localhost", "::1", "0.0.0.0", "::"].includes(host))
    throw new Error(
      "Local management accepts only loopback/wildcard listen hosts; no token was sent.",
    );
  return host === "::1" ? "[::1]" : "127.0.0.1";
};
async function main() {
  const config = configuration();
  const supplier = supplierSettings();
  const runDir = resolve(config.dataDir, "run");
  const recordPath = (role: Role) => join(runDir, `${role}.json`);
  const urlFor = (role: Role) =>
    role === "relay"
      ? `http://${localHost(config.host)}:${config.port}`
      : `http://${localHost(supplier.host)}:${supplier.port}`;
  const expectedId = (role: Role) =>
    role === "relay"
      ? configurationId(config)
      : supplierConfigurationId(supplier);
  const record = (role: Role): Record | null => {
    if (!existsSync(recordPath(role))) return null;
    try {
      return JSON.parse(readFileSync(recordPath(role), "utf8"));
    } catch {
      throw new Error(
        "Local process record is unreadable; preserve it and inspect before managing the process.",
      );
    }
  };
  const health = async (role: Role): Promise<Health | null> => {
    try {
      const response = await fetch(
        urlFor(role) + (role === "relay" ? "/v1/health" : "/health"),
        { signal: AbortSignal.timeout(1500) },
      );
      if (!response.ok) {
        if (role !== "supplier") return null;
        const inventory = await fetch(urlFor(role) + "/inventory", {
          signal: AbortSignal.timeout(1500),
        });
        const body = (await inventory.json()) as {
          data?: { supplier_source?: string }[];
        };
        return inventory.ok &&
          Array.isArray(body.data) &&
          body.data.length > 0 &&
          body.data.every(
            (row) => row.supplier_source === "relay_supplier_http",
          )
          ? { status: "ok", project: "Relay supplier" }
          : null;
      }
      const body = (await response.json()) as Health;
      return body.status === "ok" &&
        body.project === (role === "relay" ? "ROVER Relay" : "Relay supplier")
        ? body
        : null;
    } catch {
      return null;
    }
  };
  const status = async (role: Role) => {
    const doc = await health(role);
    const saved = record(role);
    let readiness: unknown = null;
    if (
      role === "relay" &&
      doc?.readinessUrl === "/v1/readiness" &&
      doc.configurationId === expectedId(role)
    ) {
      try {
        const response = await fetch(urlFor(role) + "/v1/readiness", {
          headers: config.sample
            ? {}
            : { Authorization: `Bearer ${config.accessToken}` },
          signal: AbortSignal.timeout(2000),
        });
        readiness = response.ok
          ? await response.json()
          : {
              authenticated: false,
              detail:
                "Relay readiness authentication failed; check the local Relay token.",
            };
      } catch {
        readiness = {
          detail:
            "Relay health answered but readiness is unavailable; no sponsor check attempted.",
        };
      }
    }
    return {
      service: role,
      reachable: !!doc,
      configured: true,
      managed: !!doc?.instanceId && saved?.instanceId === doc.instanceId,
      configurationMatches: doc?.configurationId
        ? doc.configurationId === expectedId(role)
        : null,
      mode: doc?.mode || null,
      readiness,
      legacy: !!doc && !doc.instanceId,
      detail: doc
        ? "Running; no new process started. Legacy/external processes are never stopped by this command."
        : "Not responding as the expected service; status does not start, kill or replace a process.",
    };
  };
  const start = async (role: Role) => {
    const current = await status(role);
    if (current.reachable) {
      if (
        current.configurationMatches === false ||
        (role === "relay" &&
          current.mode !== (config.sample ? "offline_sample" : "live_sponsors"))
      )
        throw new Error(
          "The existing service uses a different configuration. Choose another port/data directory or explicitly stop its owner; it was not replaced.",
        );
      return current;
    }
    const prior = record(role);
    if (prior) {
      let alive = true;
      try {
        process.kill(prior.pid, 0);
      } catch (error) {
        alive = (error as NodeJS.ErrnoException).code !== "ESRCH";
      }
      if (alive)
        throw new Error(
          "A previously managed process is still starting or running. Inspect its local status and log; no duplicate was started.",
        );
    }
    await assertPortAvailable(
      role === "relay" ? config.host : supplier.host,
      role === "relay" ? config.port : supplier.port,
    );
    mkdirSync(runDir, { recursive: true });
    const token = randomBytes(32).toString("hex");
    const launchId = randomUUID();
    const log = openSync(join(runDir, `${role}.log`), "a", 0o600);
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        role === "relay" ? "src/server.ts" : "supplier-fixtures/server.ts",
      ],
      {
        cwd: process.cwd(),
        detached: true,
        windowsHide: true,
        stdio: ["ignore", log, log],
        env: {
          ...process.env,
          ...(args.includes("--system-ca") ? { NODE_USE_SYSTEM_CA: "1" } : {}),
          RELAY_LOCAL_CONTROL_TOKEN: token,
          RELAY_LOCAL_LAUNCH_ID: launchId,
        },
      },
    );
    await new Promise<void>((accept, reject) => {
      child.once("spawn", accept);
      child.once("error", reject);
    }).finally(() => closeSync(log));
    child.unref();
    const saved: Record = { pid: child.pid!, launchId, token };
    writeFileSync(recordPath(role), JSON.stringify(saved), { mode: 0o600 });
    for (let attempt = 0; attempt < 60; attempt++) {
      const doc = await health(role);
      if (
        doc?.launchId === launchId &&
        doc.configurationId === expectedId(role)
      ) {
        saved.instanceId = doc.instanceId;
        writeFileSync(recordPath(role), JSON.stringify(saved), { mode: 0o600 });
        return status(role);
      }
      if (child.exitCode !== null)
        throw new Error(
          "The child stopped before becoming ready. Inspect its private log and writer lock; raw logs are not printed.",
        );
      await delay(250);
    }
    throw new Error(
      "Startup did not become ready within its bounded wait. The process record/log were preserved; inspect status before retrying.",
    );
  };
  const stop = async (role: Role) => {
    const doc = await health(role);
    const saved = record(role);
    if (!doc)
      return {
        service: role,
        status: "not_responding",
        detail:
          "No process was killed and no data/lock was deleted. Inspect a stale process or lock manually.",
      };
    if (
      !saved ||
      saved.instanceId !== doc.instanceId ||
      saved.launchId !== doc.launchId
    )
      return {
        service: role,
        status: "external_running",
        detail:
          "This command did not start this instance; stop it in its original terminal/launcher. No process was killed.",
      };
    const response = await fetch(urlFor(role) + "/internal/local/stop", {
      method: "POST",
      headers: { "x-relay-local-control": saved.token },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok)
      throw new Error(
        "Managed graceful stop was refused; no forced termination attempted.",
      );
    for (let attempt = 0; attempt < 40; attempt++) {
      const lockPath =
        role === "relay"
          ? join(config.dataDir, ".relay-writer.lock")
          : join(supplier.directory, ".supplier-writer.lock");
      const lockReleased =
        !existsSync(lockPath) ||
        JSON.parse(readFileSync(lockPath, "utf8")).instanceId !==
          saved.instanceId;
      if (
        (await health(role))?.instanceId !== saved.instanceId &&
        lockReleased
      ) {
        if (record(role)?.launchId === saved.launchId)
          unlinkSync(recordPath(role));
        return {
          service: role,
          status: "stopped",
          detail: "Graceful shutdown; persisted data retained.",
        };
      }
      await delay(100);
    }
    throw new Error(
      "Graceful shutdown remains in progress. No forced termination or data removal attempted.",
    );
  };
  const postgres = async () => {
    if (!config.databaseUrl)
      return {
        service: "postgres",
        configured: false,
        detail: "SQLite selected; no Docker action.",
      };
    const target = new URL(config.databaseUrl);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname))
      throw new Error(
        "Local Docker management refuses non-loopback DATABASE_URL targets.",
      );
    const name = process.env.RELAY_POSTGRES_CONTAINER || "relay-courier-source";
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(name))
      throw new Error("Invalid RELAY_POSTGRES_CONTAINER");
    let container;
    try {
      container = JSON.parse(
        execFileSync("docker", ["inspect", name], {
          encoding: "utf8",
          timeout: 5000,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      )[0];
    } catch {
      throw new Error(
        "Docker or the existing Relay PostgreSQL container is unavailable. Start Docker Desktop/check WSL; no container or volume was created.",
      );
    }
    const binding = container.HostConfig.PortBindings?.["5432/tcp"] || [];
    if (
      container.Config.Labels?.["rover-relay.role"] !== "courier-source" ||
      !container.Mounts.some(
        (mount: { Type: string; Destination: string }) =>
          mount.Type === "volume" &&
          mount.Destination === "/var/lib/postgresql/data",
      ) ||
      !binding.some(
        (port: { HostIp: string; HostPort: string }) =>
          ["127.0.0.1", "::1"].includes(port.HostIp) &&
          port.HostPort === (target.port || "5432"),
      )
    )
      throw new Error(
        "Existing container identity, persisted volume or loopback port mapping does not match Relay. Inspect manually; nothing was replaced.",
      );
    if ((action === "start" && !container.State.Running) || action === "stop") {
      execFileSync("docker", [action, name], {
        timeout: 15000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    const result = {
      service: "postgres",
      configured: true,
      reachable: null as boolean | null,
      authenticated: null as boolean | null,
      checkedAt: new Date().toISOString(),
      lastExercisedAt: null as string | null,
      detail:
        "Only the existing labeled container/volume is managed; no Compose stack or replacement is created.",
    };
    if (action !== "stop") {
      const client = new pg.Client({
        connectionString: config.databaseUrl,
        connectionTimeoutMillis: 2000,
        query_timeout: 2000,
      });
      try {
        await client.connect();
        await client.query("SELECT 1");
        result.reachable = true;
        result.authenticated = true;
        result.lastExercisedAt = new Date().toISOString();
      } catch (error) {
        const code = (error as { code?: string }).code;
        result.reachable = code?.startsWith("28") ? true : null;
        result.authenticated = code?.startsWith("28") ? false : null;
        result.detail =
          "PostgreSQL not authenticated/ready. Check the private URL, port mapping and Docker status; no raw database error printed.";
      } finally {
        await client.end().catch(() => {});
      }
    }
    return result;
  };
  const requested = option("service") || (action === "status" ? "all" : "apps");
  const roles =
    requested === "all"
      ? ["postgres", "supplier", "relay"]
      : requested === "apps"
        ? ["supplier", "relay"]
        : [requested];
  const ordered = action === "stop" ? [...roles].reverse() : roles;
  const results = [];
  for (const role of ordered) {
    try {
      results.push(
        role === "postgres"
          ? await postgres()
          : action === "start"
            ? await start(role as Role)
            : action === "stop"
              ? await stop(role as Role)
              : await status(role as Role),
      );
    } catch (error) {
      process.exitCode = 1;
      // All thrown messages above are bounded local guidance. Do not print raw child/process errors.
      const detail =
        error instanceof Error &&
        !/(?:password|Bearer|nvapi-|postgresql:\/\/)/i.test(error.message) &&
        !/Command failed|spawn /i.test(error.message)
          ? error.message.slice(0, 400)
          : "Local management failed. Check prerequisites and private logs; raw errors and credentials were hidden.";
      results.push({ service: role, status: "failed", detail });
      if (action === "start") break;
    }
  }
  console.log(
    JSON.stringify(
      { checkedAt: new Date().toISOString(), action, results },
      null,
      2,
    ),
  );
}
await main().catch(() => {
  console.error(
    "Local management configuration failed. Check explicit boolean/port/provider values and local-only service addresses; credentials were hidden.",
  );
  process.exitCode = 1;
});
