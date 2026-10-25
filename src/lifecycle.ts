import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:net";
import type { FastifyInstance } from "fastify";
import { RelayError } from "./types.ts";

export function acquireWriterLock(
  directory: string,
  name = ".relay-writer.lock",
) {
  mkdirSync(directory, { recursive: true });
  const path = join(realpathSync(directory), name);
  const instanceId = randomUUID();
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new RelayError(
      503,
      "writer_locked",
      "This data directory is locked by another instance or a previous unclean exit. Stop the owning process; remove a stale lock only after verifying its PID is no longer running. No data was reset.",
    );
  }
  try {
    writeFileSync(
      fd,
      JSON.stringify({
        pid: process.pid,
        instanceId,
        startedAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    closeSync(fd);
    unlinkSync(path);
    throw error;
  }
  closeSync(fd);
  let released = false;
  return {
    instanceId,
    release() {
      if (released) return;
      const current = JSON.parse(readFileSync(path, "utf8"));
      if (current.instanceId !== instanceId)
        throw new Error("Writer lock ownership changed; lock preserved.");
      unlinkSync(path);
      released = true;
    },
  };
}

export async function assertPortAvailable(host: string, port: number) {
  const server = createServer();
  try {
    await new Promise<void>((accept, reject) => {
      server.once("error", reject);
      server.listen({ host, port, exclusive: true }, accept);
    });
  } catch {
    throw new RelayError(
      503,
      "port_unavailable",
      "The requested local port is occupied or blocked. Run the local status command, reuse the existing service, or choose an available port. On Windows check excluded TCP port ranges.",
    );
  } finally {
    if (server.listening)
      await new Promise<void>((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept())),
      );
  }
}

export function installLocalControl(
  app: FastifyInstance,
  token: string | undefined,
) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
  app.post("/internal/local/stop", async (request, reply) => {
    const received = String(request.headers["x-relay-local-control"] || "");
    if (
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.ip) ||
      Buffer.byteLength(received) !== Buffer.byteLength(token) ||
      !timingSafeEqual(Buffer.from(received), Buffer.from(token))
    )
      return reply.code(404).send({ error: "not_found" });
    reply.send({ status: "stopping" });
    setImmediate(() => {
      void app.close();
    });
    return reply;
  });
}

export function supplierSettings() {
  const port = Number(process.env.SUPPLIER_PORT || 4174);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid SUPPLIER_PORT");
  const path = resolve(
    process.env.SUPPLIER_DATA_FILE || ".data/supplier/inventory.sqlite",
  );
  return {
    path,
    directory: dirname(path),
    host: process.env.SUPPLIER_HOST || "127.0.0.1",
    port,
  };
}

export function supplierConfigurationId(
  settings: ReturnType<typeof supplierSettings>,
) {
  return createHash("sha256").update(JSON.stringify(settings)).digest("hex");
}
