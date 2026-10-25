import { addEvent, ownedMission, sameOwner } from "../domain.ts";
import {
  RelayError,
  type State,
  type Store,
  type Mode,
  type Task,
  type Candidate,
  type Identity,
  type TaskStatus,
} from "../types.ts";
import type { ApprovedExecutionIntent } from "../execution-contract.ts";
import {
  activeExecutionStates as activeStates,
  executionState,
  type ExecutionAdapter,
} from "../execution.ts";
export class SimulatorExecutor implements ExecutionAdapter {
  readonly backend = "simulator" as const;
  constructor(
    private store: Store,
    private mode: Mode,
    private clock = Date.now,
  ) {}
  stage(
    state: State,
    task: Task,
    _intent: ApprovedExecutionIntent,
    candidate: Candidate,
  ) {
    const courier = state.fixtures.couriers.find(
      (courier) => courier.id === candidate.courier.id,
    );
    // In live-sponsor mode the public simulator reserves a local shadow
    // courier by source ID; it never writes to a real provider system.
    if (this.mode === "live_sponsors" && !courier)
      state.fixtures.couriers.push({ ...candidate.courier });
    const reservable = state.fixtures.couriers.find(
      (courier) => courier.id === candidate.courier.id,
    )!;
    if (
      !reservable.available ||
      Object.values(state.tasks).some(
        (task) =>
          task.courierId === reservable.id &&
          activeStates.includes(task.status),
      )
    )
      throw new RelayError(
        409,
        "courier_unavailable",
        "Courier is already reserved in the simulator.",
      );
    if (
      Object.values(state.tasks).some(
        (other) =>
          other.missionId === task.missionId &&
          other.courierId === reservable.id &&
          other.status === "declined",
      )
    )
      throw new RelayError(
        409,
        "courier_declined",
        "This courier declined this mission. Review a different provider proposal.",
      );
    reservable.available = false;
    reservable.version++;
    state.fixtures.revision++;
  }
  async drainOutbox() {
    await this.store.transact((state) => {
      for (const message of state.outbox.filter(
        (message) => !message.delivered,
      )) {
        const task = state.tasks[message.taskId];
        if (task.execution && task.execution.backend !== this.backend)
          throw new RelayError(
            503,
            "execution_backend_mismatch",
            "Restore the task's original execution adapter before recovery.",
          );
        if (task.status === "queued") {
          if (state.missions[task.missionId].taskId !== task.id)
            throw new RelayError(
              409,
              "stale_task",
              "An obsolete task cannot send a simulated offer.",
            );
          task.status = "dispatch_requested";
          task.revision = (task.revision ?? 0) + 1;
          state.missions[task.missionId].status = task.status;
          const intent = state.executionIntents?.[task.id];
          if (intent)
            executionState(task, intent, new Date(this.clock()).toISOString());
          addEvent(
            state,
            task.missionId,
            this.mode,
            "simulated_offer_sent",
            { taskId: task.id, eventId: message.id },
            this.clock(),
          );
        }
        message.delivered = true;
      }
      return null;
    });
  }

  async cancelTask(
    identity: Identity,
    taskId: string,
    expectedRevision?: number,
  ) {
    return (
      await this.transition(
        identity,
        taskId,
        "cancelled",
        undefined,
        expectedRevision,
      )
    ).task;
  }
  async transition(
    identity: Identity,
    taskId: string,
    status: TaskStatus,
    signal?: AbortSignal,
    expectedRevision?: number,
  ) {
    const allowed: Partial<Record<TaskStatus, TaskStatus[]>> = {
      queued: ["cancelled"],
      dispatch_requested: ["accepted", "declined", "cancelled"],
      accepted: ["in_progress", "cancelled"],
      in_progress: ["completed", "cancelled"],
    };
    const result = await this.store.transact((state) => {
      const task = state.tasks[taskId];
      if (!task || !sameOwner(task.owner, identity))
        throw new RelayError(404, "not_found", "Task not found.");
      if (task.execution && task.execution.backend !== this.backend)
        throw new RelayError(
          409,
          "execution_backend_mismatch",
          "This task belongs to a different execution adapter.",
        );
      if (task.status === status) return { task, changed: false };
      if (signal?.aborted)
        throw new RelayError(
          503,
          "operation_cancelled",
          "The simulated transition was cancelled before commit.",
        );
      const mission = ownedMission(state, task.missionId, identity);
      if (mission.taskId !== task.id)
        throw new RelayError(
          409,
          "stale_task",
          "An obsolete task cannot change the current mission.",
        );
      if (
        expectedRevision !== undefined &&
        expectedRevision !== (task.revision ?? 0)
      )
        throw new RelayError(
          409,
          "stale_task_revision",
          "Reload the task's current revision before changing it.",
        );
      if (!allowed[task.status]?.includes(status))
        throw new RelayError(
          409,
          "invalid_transition",
          `Cannot change ${task.status} to ${status}.`,
        );
      const previousStatus = task.status;
      const now = this.clock();
      if (status === "cancelled") {
        addEvent(
          state,
          task.missionId,
          this.mode,
          "cancellation_requested",
          { taskId, previousStatus, backend: "simulator", simulated: true },
          now,
        );
        task.cancellation = {
          requestedAt: new Date(now).toISOString(),
          confirmedAt: new Date(now).toISOString(),
          backend: "simulator",
        };
      }
      task.status = status;
      task.revision = (task.revision ?? 0) + 1;
      mission.status = status;
      const intent = state.executionIntents?.[task.id];
      if (intent) executionState(task, intent, new Date(now).toISOString());
      if (["completed", "declined", "cancelled"].includes(status)) {
        const courier = state.fixtures.couriers.find(
          (courier) => courier.id === task.courierId,
        );
        if (courier) {
          if (
            Object.values(state.tasks).some(
              (other) =>
                other.id !== task.id &&
                other.courierId === courier.id &&
                activeStates.includes(other.status),
            )
          )
            throw new RelayError(
              409,
              "reservation_conflict",
              "Another active task owns this simulated courier slot.",
            );
          courier.available = true;
          courier.version++;
          state.fixtures.revision++;
        }
      }
      addEvent(
        state,
        task.missionId,
        this.mode,
        `simulated_${status}`,
        {
          taskId,
          status,
          previousStatus,
          revision: task.revision,
          backend: "simulator",
          simulated: true,
        },
        now,
      );
      return { task, changed: true };
    });
    return result;
  }
}
