import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { z } from "zod";
import { SqliteStore, PostgresStore } from "./store.ts";
import { SampleData, ZetarisData } from "./adapters/data.ts";
import { SampleGenerator, liveGenerator } from "./agents.ts";
import { MemoryAdapter } from "./memory.ts";
import { RelayService } from "./service.ts";
import { configuration, type Config } from "./config.ts";
import { RelayError, type Identity, type Store } from "./types.ts";
import { addEvent } from "./domain.ts";
import { acquireWriterLock, installLocalControl } from "./lifecycle.ts";
import { Readiness, configurationId } from "./readiness.ts";

async function cancellable<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  operation: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const aborted = () => controller.abort();
  const closed = () => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  request.raw.once("aborted", aborted);
  reply.raw.once("close", closed);
  try {
    return await operation(controller.signal);
  } finally {
    request.raw.off("aborted", aborted);
    reply.raw.off("close", closed);
  }
}

export async function createApp(
  options: { config?: Config; store?: Store; clock?: () => number } = {},
) {
  const config = options.config ?? configuration();
  if (!config.sample && config.accessToken.length < 24)
    throw new RelayError(
      503,
      "missing_configuration",
      "Live mode requires a RELAY_ACCESS_TOKEN of at least 24 characters.",
    );
  const readiness = new Readiness(config, options.clock);
  const lock = acquireWriterLock(config.dataDir);
  try {
    const result = await buildApp(
      { ...options, config },
      readiness,
      lock.instanceId,
    );
    result.app.addHook("onClose", async () => lock.release());
    return { ...result, readiness };
  } catch (error) {
    lock.release();
    throw error;
  }
}

async function buildApp(
  options: { config: Config; store?: Store; clock?: () => number },
  readiness: Readiness,
  instanceId: string,
) {
  const config = options.config ?? configuration();
  const clock = options.clock ?? Date.now;
  let store = options.store;
  if (!store) {
    if (config.databaseUrl) {
      const pg = new PostgresStore(config.databaseUrl);
      try {
        await pg.initialize();
      } catch {
        await pg.close();
        throw new RelayError(
          503,
          "storage_unavailable",
          "PostgreSQL could not be initialized. Check the private database URL, authentication and local database status; no data was reset.",
        );
      }
      store = pg;
    } else store = new SqliteStore(resolve(config.dataDir, "relay.sqlite"));
  }
  let service: RelayService;
  let memory: MemoryAdapter;
  try {
    memory = new MemoryAdapter(resolve(config.dataDir, "hmem"), clock);
    service = new RelayService(
      store,
      readiness.data(
        config.sample ? new SampleData(store, clock) : new ZetarisData(),
      ),
      readiness.generator(
        config.sample ? new SampleGenerator() : liveGenerator(),
      ),
      memory,
      config.sample ? "offline_sample" : "live_sponsors",
      config.planTtlSeconds,
      clock,
    );
    await service.drainOutbox();
  } catch (error) {
    await store.close();
    throw error;
  }
  const app = Fastify({
    logger: false,
    bodyLimit: 32768,
    requestTimeout: 190000,
  });
  app.decorateRequest("identity");
  app.addHook("onRequest", async (request, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("Cache-Control", "no-store");
    if (!request.url.startsWith("/v1") && !request.url.startsWith("/demo"))
      return;
    if (request.url === "/v1/health") return;
    let identity: Identity;
    if (config.sample) {
      const user = request.headers["x-relay-demo-user"] ?? "coordinator";
      if (user !== "coordinator" && user !== "reviewer")
        throw new RelayError(
          401,
          "invalid_demo_identity",
          "Use a documented local demo identity.",
        );
      identity = { tenant: "relay-demo", user };
    } else {
      const received = request.headers.authorization || "";
      const expected = `Bearer ${config.accessToken}`;
      if (
        Buffer.byteLength(received) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(received), Buffer.from(expected))
      )
        throw new RelayError(
          401,
          "unauthorized",
          "A valid Relay access token is required.",
        );
      identity = { tenant: "relay-demo", user: "coordinator" };
    }
    request.identity = identity;
    if (
      request.url.startsWith("/demo") &&
      !config.sample &&
      (!request.url.startsWith("/demo/tasks/") || !config.demo)
    )
      throw new RelayError(
        404,
        "not_found",
        "Demo controls are disabled for this operation.",
      );
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: "invalid_input",
        message: "Input does not match the required schema.",
        issues: error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      });
    if (error instanceof RelayError)
      return reply
        .code(error.status)
        .send({ error: error.code, message: error.message });
    if (
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    )
      return reply
        .code(error.statusCode)
        .send({ error: "invalid_request", message: "Invalid request." });
    // Do not reflect raw dependency errors or credential-bearing requests.
    return reply.code(500).send({
      error: "internal_error",
      message: "The operation failed. Inspect local server diagnostics.",
    });
  });
  app.get("/v1/health", async () => ({
    status: "ok",
    project: "ROVER Relay",
    version: "0.1.0",
    mode: service.mode,
    operations: "simulated",
    storage: config.databaseUrl ? "postgresql" : "sqlite",
    sponsorCallsVerified: false,
    sponsorCallsVerifiedDeprecated:
      "Use /v1/readiness and recorded workflow evidence; this legacy field is not an attestation.",
    readinessUrl: "/v1/readiness",
    instanceId,
    launchId: process.env.RELAY_LOCAL_LAUNCH_ID || null,
    configurationId: configurationId(config),
    startedAt: readiness.startedAt,
  }));
  app.get("/v1/readiness", async () => readiness.snapshot());
  installLocalControl(app, process.env.RELAY_LOCAL_CONTROL_TOKEN);
  app.get("/v1/bootstrap", async (request) => ({
    mode: service.mode,
    operations: "simulated",
    fixtures: (await store.read()).fixtures,
    readiness: readiness.snapshot(),
    capabilities: { taskSimulation: config.sample || config.demo },
    missions: await service.list(request.identity),
    intakes: await service.listIntakes(request.identity),
    preferences: memory.recall(request.identity, "auditorium"),
    liveModel: {
      route: process.env.METERLESS_ROUTE || null,
      expectedModel: process.env.NEMOTRON_MODEL || null,
      identityVerification:
        "Correlate Runtime receipts; configured model is not proof of inference.",
    },
  }));
  app.post("/v1/missions", async (request, reply) => {
    const mission = await cancellable(request, reply, (signal) =>
      service.create(request.identity, request.body, signal),
    );
    return reply.code(201).send(mission);
  });
  app.post("/v1/intakes", async (request, reply) =>
    reply
      .code(201)
      .send(await service.createIntake(request.identity, request.body)),
  );
  app.get<{ Params: { id: string } }>("/v1/intakes/:id", (request) =>
    service.getIntake(request.identity, request.params.id),
  );
  app.patch<{ Params: { id: string } }>("/v1/intakes/:id", (request) =>
    service.updateIntake(request.identity, request.params.id, request.body),
  );
  app.post<{ Params: { id: string } }>(
    "/v1/intakes/:id/confirm",
    (request, reply) =>
      cancellable(request, reply, (signal) =>
        service.confirmIntake(
          request.identity,
          request.params.id,
          request.body,
          signal,
        ),
      ),
  );
  app.get<{ Params: { id: string } }>("/v1/missions/:id", (request) =>
    service.get(request.identity, request.params.id),
  );
  app.get<{ Params: { id: string } }>("/v1/missions/:id/events", (request) =>
    service.events(request.identity, request.params.id),
  );
  app.get<{ Params: { id: string } }>(
    "/v1/missions/:id/evidence.jsonl",
    async (request, reply) =>
      reply
        .type("application/x-ndjson")
        .send(
          (await service.events(request.identity, request.params.id))
            .map((event) => JSON.stringify(event))
            .join("\n") + "\n",
        ),
  );
  app.post<{ Params: { id: string } }>(
    "/v1/missions/:id/replan",
    (request, reply) =>
      cancellable(request, reply, (signal) =>
        service.plan(
          request.identity,
          request.params.id,
          "Coordinator requested a fresh plan.",
          signal,
        ),
      ),
  );
  app.post<{ Params: { id: string } }>(
    "/v1/missions/:id/approve",
    async (request, reply) => {
      const body = z
        .object({
          version: z.number().int().positive(),
          digest: z.string().regex(/^[a-f0-9]{64}$/),
          idempotencyKey: z.string().min(8).max(100),
        })
        .strict()
        .parse(request.body);
      return cancellable(request, reply, (signal) =>
        service.requestDispatch(
          request.identity,
          request.params.id,
          body.version,
          body.digest,
          body.idempotencyKey,
          signal,
        ),
      );
    },
  );
  app.get<{ Params: { id: string } }>("/v1/tasks/:id", (request) =>
    service.getTask(request.identity, request.params.id),
  );
  app.post<{ Params: { id: string } }>("/v1/tasks/:id/cancel", (request) => {
    const body = z
      .object({ expectedRevision: z.number().int().min(0).optional() })
      .strict()
      .parse(request.body ?? {});
    return service.cancelTask(
      request.identity,
      request.params.id,
      body.expectedRevision,
    );
  });
  app.put("/v1/preferences/entrance", async (request) => {
    const body = z
      .object({
        venue: z.enum(["auditorium", "library"]),
        entrance: z.string().trim().min(2).max(120),
      })
      .strict()
      .parse(request.body);
    return memory.set(request.identity, body.venue, body.entrance);
  });
  app.get("/v1/preferences/entrance", async (request) => {
    const query = z
      .object({ venue: z.enum(["auditorium", "library"]) })
      .parse(request.query);
    return memory.recall(request.identity, query.venue);
  });
  app.delete("/v1/preferences/entrance", async (request) => {
    const body = z
      .object({ venue: z.enum(["auditorium", "library"]) })
      .strict()
      .parse(request.body);
    return memory.forget(request.identity, body.venue);
  });
  app.post<{ Params: { id: string } }>(
    "/demo/tasks/:id/response",
    (request, reply) => {
      const body = z
        .object({
          status: z.enum(["accepted", "declined", "in_progress", "completed"]),
          expectedRevision: z.number().int().min(0).optional(),
        })
        .strict()
        .parse(request.body);
      return cancellable(request, reply, (signal) =>
        service.transition(
          request.identity,
          request.params.id,
          body.status,
          signal,
          body.expectedRevision,
        ),
      );
    },
  );
  app.post("/demo/disruptions", async (request) => {
    const body = z
      .discriminatedUnion("type", [
        z
          .object({
            type: z.literal("stock"),
            supplierId: z.string(),
            stock: z.number().int().min(0).max(100),
          })
          .strict(),
        z
          .object({
            type: z.literal("route"),
            edgeId: z.string(),
            closed: z.boolean(),
          })
          .strict(),
      ])
      .parse(request.body);
    return store.transact((state) => {
      let before: Record<string, unknown>;
      let after: Record<string, unknown>;
      if (body.type === "stock") {
        const supplier = state.fixtures.suppliers.find(
          (supplier) => supplier.id === body.supplierId,
        );
        if (!supplier)
          throw new RelayError(404, "not_found", "Supplier not found.");
        if (supplier.stock === body.stock) return state.fixtures;
        before = { ...supplier };
        supplier.stock = body.stock;
        supplier.version++;
        after = { ...supplier };
      } else {
        const edge = state.fixtures.edges.find(
          (edge) => edge.id === body.edgeId,
        );
        if (!edge)
          throw new RelayError(404, "not_found", "Route edge not found.");
        if (edge.closed === body.closed) return state.fixtures;
        before = { ...edge };
        edge.closed = body.closed;
        edge.version = (edge.version ?? state.fixtures.revision) + 1;
        after = { ...edge };
      }
      state.fixtures.revision++;
      for (const mission of Object.values(state.missions).filter(
        (mission) => mission.status === "awaiting_approval",
      ))
        addEvent(
          state,
          mission.id,
          service.mode,
          "source_changed",
          { ...body, before, after, simulated: true },
          clock(),
        );
      return state.fixtures;
    });
  });
  const publicRoot = resolve("dist/ui");
  app.get("/*", async (request, reply) => {
    if (request.url.startsWith("/v1/") || request.url.startsWith("/demo/"))
      return reply.code(404).send({ error: "not_found" });
    const pathname = decodeURIComponent(request.url.split("?")[0]);
    const filename = resolve(
      publicRoot,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (!filename.startsWith(publicRoot + sep))
      return reply.code(404).send({ error: "not_found" });
    try {
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
      };
      if (extname(filename) === ".html")
        reply.header(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        );
      return reply
        .type(mime[extname(filename)] || "application/octet-stream")
        .send(await readFile(filename));
    } catch {
      return reply
        .code(404)
        .type("text/plain")
        .send("UI not built. Run npm run build, then restart.");
    }
  });
  app.addHook("onClose", () => store.close());
  return { app, service, config };
}

declare module "fastify" {
  interface FastifyRequest {
    identity: Identity;
  }
}
