import { createHash, randomUUID } from "node:crypto";
import { addEvent, hash, ownedMission, sameOwner } from "../domain.ts";
import { activeExecutionStates, type ExecutionAdapter } from "../execution.ts";
import {
  executionConflictSchema,
  executionEventSchema,
  parseExecutionTask,
  parseExecutionIntent,
  type ApprovedExecutionIntent,
  type ExecutionTaskState,
} from "../execution-contract.ts";
import {
  RelayError,
  type Candidate,
  type Identity,
  type Mode,
  type State,
  type Store,
  type Task,
} from "../types.ts";

export type GatewayRequest = {
  identity: Identity;
  method: "GET" | "POST";
  path: string;
  bodyDigest: string;
};
export const gatewayBodyDigest = (body: string) =>
  createHash("sha256").update(body, "utf8").digest("hex");
type Options = {
  baseUrl: string;
  // Supplied by a separately verified internal channel. Never forward the demo
  // token or accept unsigned tenant/user headers. Fixture uses signed assertions.
  authorize: (request: GatewayRequest) => Promise<string>;
  timeoutMs?: number;
};
export class HttpGatewayExecutor implements ExecutionAdapter {
  readonly backend = "http_gateway" as const;
  private origin: string;
  private timeoutMs: number;
  constructor(
    private store: Store,
    private mode: Mode,
    private options: Options,
    private clock = Date.now,
  ) {
    const url = new URL(options.baseUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["127.0.0.1", "[::1]"].includes(url.hostname))
      )
    )
      throw new Error(
        "Gateway requires an HTTPS origin or a loopback HTTP fixture.",
      );
    this.origin = url.origin;
    this.timeoutMs = options.timeoutMs ?? 5000;
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 10 ||
      this.timeoutMs > 30000
    )
      throw new Error("Gateway timeout must be 10–30000 ms.");
  }
  stage(
    state: State,
    task: Task,
    _intent: ApprovedExecutionIntent,
    _candidate: Candidate,
  ) {
    // Local pending intents own one slot too. The remote transaction must also
    // reserve authoritative capacity; synthetic fixtures are never mutated here.
    if (
      Object.values(state.tasks).some(
        (other) =>
          activeExecutionStates.includes(other.status) &&
          (other.missionId === task.missionId ||
            other.courierId === task.courierId),
      )
    )
      throw new RelayError(
        409,
        "provider_unavailable",
        "An active execution already owns this mission or provider.",
      );
  }
  private owned(state: State, identity: Identity, taskId: string) {
    const task = state.tasks[taskId];
    if (!task || !sameOwner(task.owner, identity))
      throw new RelayError(404, "not_found", "Task not found.");
    if (task.execution?.backend !== this.backend)
      throw new RelayError(
        409,
        "execution_backend_mismatch",
        "Task belongs to its original execution adapter.",
      );
    const intent = state.executionIntents?.[taskId];
    if (!intent || intent.intentId !== task.execution.intentId)
      throw new RelayError(
        503,
        "mapping_missing",
        "Persisted execution approval is unavailable.",
      );
    return { task, intent: parseExecutionIntent(intent) };
  }
  private async request(
    identity: Identity,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ) {
    const text = body === undefined ? "" : JSON.stringify(body);
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const authorization = await Promise.race([
        this.options.authorize({
          identity,
          method,
          path,
          bodyDigest: gatewayBodyDigest(text),
        }),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener(
            "abort",
            () => reject(new Error("timeout")),
            { once: true },
          ),
        ),
      ]);
      if (!authorization || /[\r\n]/.test(authorization))
        throw new Error("invalid channel assertion");
      const response = await fetch(this.origin + path, {
        method,
        redirect: "error",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${authorization}`,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: text }),
      });
      const reader = response.body?.getReader();
      let length = 0,
        chunks: Uint8Array[] = [];
      if (reader)
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.length;
          if (length > 32768) {
            await reader.cancel();
            throw new Error("oversize response");
          }
          chunks.push(next.value);
        }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!response.ok) {
        const conflict = executionConflictSchema.safeParse(value);
        if (conflict.success && [400, 409, 503].includes(response.status))
          throw new RelayError(
            response.status,
            conflict.data.error,
            `Execution gateway reported ${conflict.data.error}; reconcile or review approved terms.`,
          );
        throw new Error("invalid gateway error");
      }
      return parseExecutionTask(value);
    } catch (error) {
      if (error instanceof RelayError) throw error;
      throw new RelayError(
        503,
        "dependency_unavailable",
        "Gateway outcome is unresolved. Retry the same approval key; do not create another execution.",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  private async apply(
    identity: Identity,
    taskId: string,
    remote: ExecutionTaskState,
    messageId?: string,
  ) {
    return this.store.transact((state) => {
      const { task, intent } = this.owned(state, identity, taskId);
      if (
        remote.taskId !== task.id ||
        remote.intentId !== intent.intentId ||
        remote.missionId !== task.missionId ||
        remote.executionBackend !== this.backend ||
        hash(remote.request) !== hash(intent.request) ||
        hash(remote.approvedPlan) !== hash(intent.approvedPlan) ||
        hash(remote.selected) !== hash(intent.selected) ||
        !remote.jobId ||
        (task.execution!.jobId && remote.jobId !== task.execution!.jobId)
      )
        throw new RelayError(
          503,
          "invalid_execution_response",
          "Gateway state does not match the persisted approved execution.",
        );
      const revision = task.revision ?? 1;
      if (remote.revision < revision) return task;
      if (remote.revision === revision) {
        if (
          task.execution!.stateDigest &&
          task.execution!.stateDigest !== hash(remote)
        )
          throw new RelayError(
            503,
            "invalid_execution_response",
            "Gateway changed an already observed state revision.",
          );
        if (
          (remote.status !== task.status &&
            !(
              remote.status === "cancel_requested" &&
              task.cancellation?.confirmedAt === null
            )) ||
          task.execution!.jobId !== remote.jobId
        )
          throw new RelayError(
            503,
            "invalid_execution_response",
            "Conflicting gateway state revision.",
          );
      } else {
        const terminal = ["completed", "declined", "cancelled"];
        const rank: Record<string, number> = {
          queued: 0,
          dispatch_requested: 1,
          accepted: 2,
          in_progress: 3,
        };
        if (
          (terminal.includes(task.status) && remote.status !== task.status) ||
          (remote.status !== "cancel_requested" &&
            !terminal.includes(remote.status) &&
            rank[remote.status] < rank[task.status]) ||
          (remote.status === "cancel_requested" && !remote.cancellation) ||
          (remote.status === "cancelled" && !remote.cancellation?.confirmedAt)
        )
          throw new RelayError(
            503,
            "invalid_execution_response",
            "Invalid authoritative task transition.",
          );
        const mission = ownedMission(state, task.missionId, identity);
        if (mission.taskId !== task.id && !terminal.includes(remote.status))
          throw new RelayError(
            409,
            "stale_task",
            "Obsolete execution cannot change the current mission.",
          );
        task.execution!.jobId = remote.jobId;
        task.execution!.stateDigest = hash(remote);
        // Requesting cancellation does not confirm release or terminal state.
        if (remote.status !== "cancel_requested") task.status = remote.status;
        task.revision = remote.revision;
        if (remote.cancellation)
          task.cancellation = {
            ...remote.cancellation,
            backend: this.backend,
            requestRevision: task.cancellation?.requestRevision,
          };
        if (mission.taskId === task.id) mission.status = task.status;
        const event = executionEventSchema.parse({
          contractVersion: "1.0",
          eventId: randomUUID(),
          type: remote.status,
          task: remote,
        });
        addEvent(
          state,
          task.missionId,
          this.mode,
          "gateway_state",
          { ...event, simulated: false },
          this.clock(),
        );
      }
      if (messageId) {
        const message = state.outbox.find(
          (m) => m.id === messageId && m.taskId === taskId,
        );
        if (message) message.delivered = true;
      }
      return task;
    });
  }
  async drainOutbox() {
    const initial = await this.store.read();
    for (const message of initial.outbox.filter((m) => !m.delivered)) {
      const task = initial.tasks[message.taskId];
      const { intent } = this.owned(initial, task.owner, task.id);
      try {
        const remote = await this.request(
          task.owner,
          "POST",
          "/internal/relay/v1/execution-intents",
          intent,
        );
        await this.apply(task.owner, task.id, remote, message.id);
      } catch (error) {
        // These contract conflicts guarantee that no job exists for this intent.
        // Transport/unknown outcomes retain the queued task and original outbox.
        if (
          error instanceof RelayError &&
          error.status === 409 &&
          [
            "provider_unavailable",
            "quote_changed",
            "mapping_missing",
            "unapproved_plan",
            "intent_expired",
            "plan_changed",
          ].includes(error.code)
        ) {
          await this.store.transact((state) => {
            const current = this.owned(state, task.owner, task.id).task;
            if (current.status !== "queued" || current.execution!.jobId) return;
            current.status = "declined";
            current.execution!.rejectionCode = error.code;
            current.revision = (current.revision ?? 1) + 1;
            const mission = ownedMission(state, current.missionId, task.owner);
            if (mission.taskId === current.id) mission.status = "declined";
            const pending = state.outbox.find((m) => m.id === message.id);
            if (pending) pending.delivered = true;
            addEvent(
              state,
              current.missionId,
              this.mode,
              "gateway_rejected",
              {
                taskId: current.id,
                code: error.code,
                backend: this.backend,
                simulated: false,
                confirmationRequired: true,
              },
              this.clock(),
            );
          });
        }
        throw error;
      }
    }
  }
  async reconcile(identity: Identity, taskId: string) {
    const { task } = this.owned(await this.store.read(), identity, taskId);
    if (task.status === "declined" && !task.execution!.jobId) return task;
    if (!task.execution!.jobId) {
      await this.drainOutbox();
    }
    const remote = await this.request(
      identity,
      "GET",
      `/internal/relay/v1/tasks/${taskId}`,
    );
    return this.apply(identity, taskId, remote);
  }
  async cancelTask(
    identity: Identity,
    taskId: string,
    expectedRevision?: number,
  ) {
    await this.reconcile(identity, taskId);
    const approved = await this.store.transact((state) => {
      const { task, intent } = this.owned(state, identity, taskId);
      if (task.status === "cancelled") return { task, intent };
      if (!task.cancellation) {
        if (
          expectedRevision !== undefined &&
          expectedRevision !== task.revision
        )
          throw new RelayError(
            409,
            "stale_task_revision",
            "Reload the authoritative task revision.",
          );
        if (!activeExecutionStates.includes(task.status))
          throw new RelayError(
            409,
            "invalid_transition",
            "Terminal execution cannot be cancelled.",
          );
        task.cancellation = {
          requestedAt: new Date(this.clock()).toISOString(),
          confirmedAt: null,
          backend: this.backend,
          requestRevision: task.revision,
        };
        addEvent(
          state,
          task.missionId,
          this.mode,
          "cancellation_requested",
          { taskId, backend: this.backend, simulated: false },
          this.clock(),
        );
      }
      return { task, intent };
    });
    if (approved.task.status === "cancelled") return approved.task;
    const remote = await this.request(
      identity,
      "POST",
      `/internal/relay/v1/tasks/${taskId}/cancel`,
      {
        contractVersion: "1.0",
        intentId: approved.intent.intentId,
        idempotencyKey: `${approved.intent.intentId}:cancel`,
        expectedRevision: approved.task.cancellation!.requestRevision,
      },
    );
    return this.apply(identity, taskId, remote);
  }
}
