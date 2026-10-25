import type { ApprovedExecutionIntent } from "./execution-contract.ts";
import type { Candidate, Identity, State, Task, TaskStatus } from "./types.ts";
import { parseExecutionTask } from "./execution-contract.ts";

// Relay owns planning/approval. Exactly one adapter owns reservation, delivery,
// reconciliation and cancellation. stage must be synchronous and transaction-only.
export interface ExecutionAdapter {
  readonly backend: "simulator" | "http_gateway";
  stage(
    state: State,
    task: Task,
    intent: ApprovedExecutionIntent,
    candidate: Candidate,
  ): void;
  drainOutbox(): Promise<void>;
  cancelTask(
    identity: Identity,
    taskId: string,
    expectedRevision?: number,
  ): Promise<Task>;
  reconcile?(identity: Identity, taskId: string): Promise<Task>;
  transition?(
    identity: Identity,
    taskId: string,
    status: TaskStatus,
    signal?: AbortSignal,
    expectedRevision?: number,
  ): Promise<{ task: Task; changed: boolean }>;
}

export const activeExecutionStates: TaskStatus[] = [
  "queued",
  "dispatch_requested",
  "accepted",
  "in_progress",
];

export function executionState(
  task: Task,
  intent: ApprovedExecutionIntent,
  updatedAt: string,
) {
  return parseExecutionTask({
    contractVersion: "1.0",
    taskId: task.id,
    intentId: intent.intentId,
    missionId: task.missionId,
    executionBackend: task.execution!.backend,
    request: intent.request,
    approvedPlan: { version: task.planVersion, digest: task.planDigest },
    selected: { supplierId: task.supplierId, courierId: task.courierId },
    jobId: task.execution!.jobId ?? null,
    status:
      task.cancellation?.confirmedAt === null
        ? "cancel_requested"
        : task.status,
    revision: task.revision ?? 1,
    updatedAt,
    ...(task.cancellation
      ? {
          cancellation: {
            requestedAt: task.cancellation.requestedAt,
            confirmedAt: task.cancellation.confirmedAt,
          },
        }
      : {}),
  });
}
