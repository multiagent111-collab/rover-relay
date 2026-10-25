// Public synthetic gateway conformance fixture. No private service/schema/key.
import { createServer } from "node:http";
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { hash, ownerKey, sameOwner } from "../../src/domain.ts";
import {
  authorizeExecutionIntent,
  executionCancelSchema,
  parseExecutionIntent,
  validateNewExecutionIntent,
  type ApprovedExecutionIntent,
  type ExecutionTaskState,
} from "../../src/execution-contract.ts";
import {
  gatewayBodyDigest,
  type GatewayRequest,
} from "../../src/adapters/http-executor.ts";
import { RelayError, type Identity, type Store } from "../../src/types.ts";

export async function gatewayFixture(store: Store, clock: () => number) {
  const secret = randomBytes(32),
    seen = new Set<string>();
  const jobs = new Map<
    string,
    {
      owner: Identity;
      intent: ApprovedExecutionIntent;
      task: ExecutionTaskState;
      cancelled?: string;
    }
  >();
  const slots = new Map<string, string>();
  const calls: string[] = [];
  let rejectNext: "quote_changed" | "provider_unavailable" | undefined;
  let timeoutAfterCommit = false,
    stallAfterCommit = false,
    timeoutCancel = false,
    responseMutation: ((task: ExecutionTaskState) => unknown) | undefined;
  const sign = async (request: GatewayRequest) => {
    const claims = Buffer.from(
      JSON.stringify({
        ...request,
        expires: clock() + 10000,
        nonce: randomUUID(),
      }),
    ).toString("base64url");
    return (
      claims +
      "." +
      createHmac("sha256", secret).update(claims).digest("base64url")
    );
  };
  const server = createServer(async (request, response) => {
    try {
      let text = "";
      for await (const chunk of request) {
        text += chunk;
        if (Buffer.byteLength(text) > 32768)
          throw new RelayError(
            400,
            "invalid_execution_intent",
            "Bounded body required.",
          );
      }
      const token =
          request.headers.authorization?.replace(/^Bearer /, "") || "",
        parts = token.split(".");
      const expected = createHmac("sha256", secret)
          .update(parts[0] || "")
          .digest(),
        actual = Buffer.from(parts[1] || "", "base64url");
      if (
        parts.length !== 2 ||
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new RelayError(
          401,
          "identity_mismatch",
          "Verified internal channel required.",
        );
      const claims = JSON.parse(
        Buffer.from(parts[0], "base64url").toString(),
      ) as GatewayRequest & { expires: number; nonce: string };
      if (
        claims.expires <= clock() ||
        claims.expires > clock() + 10000 ||
        claims.method !== request.method ||
        claims.path !== request.url ||
        claims.bodyDigest !== gatewayBodyDigest(text) ||
        seen.has(claims.nonce)
      )
        throw new RelayError(
          401,
          "identity_mismatch",
          "Invalid or replayed body-bound assertion.",
        );
      seen.add(claims.nonce);
      const identity = claims.identity;
      calls.push(`${request.method} ${request.url}`);
      let result: ExecutionTaskState,
        delay = false;
      if (
        request.method === "POST" &&
        request.url === "/internal/relay/v1/execution-intents"
      ) {
        const parsed = parseExecutionIntent(JSON.parse(text)),
          current = await store.read();
        const trustedIntent = current.executionIntents?.[parsed.taskId],
          trustedTask = current.tasks[parsed.taskId];
        const intent = authorizeExecutionIntent(
          identity,
          parsed,
          trustedIntent && trustedTask
            ? { owner: trustedTask.owner, intent: trustedIntent }
            : undefined,
        );
        const key = `${ownerKey(identity)}:${intent.intentId}`,
          existing = jobs.get(key);
        if (existing) {
          if (hash(parseExecutionIntent(existing.intent)) !== hash(intent))
            throw new RelayError(
              409,
              "idempotency_conflict",
              "Changed committed intent.",
            );
          result = existing.task;
        } else {
          validateNewExecutionIntent(intent, clock());
          if (rejectNext) {
            const code = rejectNext;
            rejectNext = undefined;
            throw new RelayError(
              409,
              code,
              "Controlled authoritative fixture rejection.",
            );
          }
          if (intent.executionBackend !== "http_gateway")
            throw new RelayError(409, "unapproved_plan", "Wrong backend.");
          // Fixture mapping/quote authority is explicit public seed data. This is
          // not a real provider mapping, inventory hold or geography conversion.
          const supplier = current.fixtures.suppliers.find(
            (s) => s.id === intent.selected.supplierId,
          );
          const courier = current.fixtures.couriers.find(
            (c) => c.id === intent.selected.courierId,
          );
          if (
            !supplier ||
            !courier ||
            !current.fixtures.nodes.some(
              (n) => n.id === intent.pickup.locationId,
            ) ||
            supplier.pickupNode !== intent.pickup.locationId
          )
            throw new RelayError(
              409,
              "mapping_missing",
              "Synthetic mapping missing.",
            );
          if (!courier.available || slots.has(courier.id))
            throw new RelayError(
              409,
              "provider_unavailable",
              "Synthetic provider slot taken.",
            );
          if (
            intent.money.deliveryEstimateCents !== courier.deliveryCents ||
            intent.money.itemEstimateCents !==
              supplier.unitPriceCents * intent.equipment.quantity
          )
            throw new RelayError(
              409,
              "quote_changed",
              "Synthetic quote changed.",
            );
          // No await between slot check and commit: serial fixture transaction.
          if (
            [...jobs.values()].some(
              (j) =>
                sameOwner(j.owner, identity) &&
                j.intent.missionId === intent.missionId &&
                !["completed", "cancelled", "declined"].includes(j.task.status),
            )
          )
            throw new RelayError(
              409,
              "job_already_active",
              "One active job per mission.",
            );
          result = {
            contractVersion: "1.0",
            taskId: intent.taskId,
            intentId: intent.intentId,
            missionId: intent.missionId,
            executionBackend: "http_gateway",
            request: intent.request,
            approvedPlan: intent.approvedPlan,
            selected: intent.selected,
            jobId: randomUUID(),
            status: "dispatch_requested",
            revision: 2,
            updatedAt: new Date(clock()).toISOString(),
          };
          jobs.set(key, { owner: identity, intent, task: result });
          slots.set(courier.id, key);
          if (timeoutAfterCommit) {
            timeoutAfterCommit = false;
            delay = true;
          }
        }
      } else {
        const match =
          /^\/internal\/relay\/v1\/tasks\/([a-f0-9-]{36})(\/cancel)?$/.exec(
            request.url || "",
          );
        const job = [...jobs.values()].find(
          (j) => j.task.taskId === match?.[1] && sameOwner(j.owner, identity),
        );
        if (!job)
          throw new RelayError(
            409,
            "mapping_missing",
            "Owned task mapping unavailable.",
          );
        if (request.method === "POST" && match?.[2]) {
          const body = executionCancelSchema.parse(JSON.parse(text));
          if (
            body.contractVersion !== "1.0" ||
            body.intentId !== job.intent.intentId ||
            body.idempotencyKey !== `${job.intent.intentId}:cancel`
          )
            throw new RelayError(
              409,
              "idempotency_conflict",
              "Invalid cancellation identity.",
            );
          const signature = hash(body);
          if (job.cancelled && job.cancelled !== signature)
            throw new RelayError(
              409,
              "idempotency_conflict",
              "Changed cancellation request.",
            );
          if (!job.cancelled) {
            if (body.expectedRevision !== job.task.revision)
              throw new RelayError(
                409,
                "stale_task_revision",
                "Current revision required.",
              );
            job.cancelled = signature;
            job.task = {
              ...job.task,
              status: "cancel_requested",
              revision: job.task.revision + 1,
              cancellation: {
                requestedAt: new Date(clock()).toISOString(),
                confirmedAt: null,
              },
            };
            if (timeoutCancel) {
              timeoutCancel = false;
              delay = true;
            }
          }
        } else if (request.method !== "GET" || match?.[2])
          throw new RelayError(
            400,
            "invalid_execution_intent",
            "Unsupported route.",
          );
        result = job.task;
      }
      if (delay) {
        if (stallAfterCommit) {
          stallAfterCommit = false;
          return;
        }
        response.destroy();
        return;
      } // committed then connection lost
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          responseMutation ? responseMutation(structuredClone(result)) : result,
        ),
      );
    } catch (error) {
      const fault =
        error instanceof RelayError
          ? error
          : new RelayError(
              400,
              "invalid_execution_intent",
              "Invalid fixture input.",
            );
      response.writeHead(fault.status, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          contractVersion: "1.0",
          error: fault.code,
          message: fault.message,
        }),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("fixture address");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    sign,
    jobs,
    calls,
    loseCreateResponse: () => {
      timeoutAfterCommit = true;
    },
    timeoutCreateResponse: () => {
      timeoutAfterCommit = true;
      stallAfterCommit = true;
    },
    rejectNextIntent: (code: "quote_changed" | "provider_unavailable") => {
      rejectNext = code;
    },
    loseCancelResponse: () => {
      timeoutCancel = true;
    },
    mutateResponse: (mutate?: (task: ExecutionTaskState) => unknown) => {
      responseMutation = mutate;
    },
    confirmCancellation: () => {
      for (const [key, job] of jobs)
        if (job.task.status === "cancel_requested") {
          job.task = {
            ...job.task,
            status: "cancelled",
            revision: job.task.revision + 1,
            cancellation: {
              ...job.task.cancellation!,
              confirmedAt: new Date(clock()).toISOString(),
            },
          };
          slots.delete(job.intent.selected.courierId);
        }
    },
    send: async (identity: Identity, value: unknown, assertion?: string) => {
      const path = "/internal/relay/v1/execution-intents",
        text = JSON.stringify(value);
      return fetch(baseUrl + path, {
        method: "POST",
        headers: {
          authorization: `Bearer ${assertion ?? (await sign({ identity, method: "POST", path, bodyDigest: gatewayBodyDigest(text) }))}`,
          "content-type": "application/json",
        },
        body: text,
      });
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
