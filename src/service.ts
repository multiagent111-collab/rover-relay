import { randomUUID } from "node:crypto";
import {
  addEvent,
  alternatives,
  enumerateCandidates,
  hash,
  ownedMission,
  ownerKey,
  sameOwner,
} from "./domain.ts";
import { reason, type Generator } from "./agents.ts";
import { MemoryAdapter } from "./memory.ts";
import {
  RelayError,
  requestSchema,
  type DataPort,
  type DispatchPort,
  type Identity,
  type Mission,
  type Mode,
  type Receipt,
  type State,
  type Store,
  type Task,
  type TaskStatus,
} from "./types.ts";

const activeStates: TaskStatus[] = [
  "queued",
  "dispatch_requested",
  "accepted",
  "in_progress",
];
export class RelayService implements DispatchPort {
  constructor(
    public store: Store,
    public data: DataPort,
    public generator: Generator,
    public memory: MemoryAdapter,
    public mode: Mode,
    private ttlSeconds = 60,
    private clock = Date.now,
  ) {}
  async create(identity: Identity, input: unknown) {
    const request = requestSchema.parse(input);
    const now = this.clock();
    const mission: Mission = {
      id: randomUUID(),
      owner: identity,
      request,
      createdAt: new Date(now).toISOString(),
      deadlineAt: new Date(now + request.deadlineMinutes * 60000).toISOString(),
      status: "planning",
      receipt: null,
      taskId: null,
      error: null,
    };
    await this.store.transact((state) => {
      state.missions[mission.id] = mission;
      addEvent(
        state,
        mission.id,
        this.mode,
        "mission_created",
        { request },
        now,
      );
    });
    return this.plan(identity, mission.id);
  }
  async get(identity: Identity, id: string) {
    return ownedMission(await this.store.read(), id, identity);
  }
  async list(identity: Identity) {
    return Object.values((await this.store.read()).missions)
      .filter((mission) => sameOwner(mission.owner, identity))
      .reverse();
  }
  async events(identity: Identity, id: string) {
    const state = await this.store.read();
    ownedMission(state, id, identity);
    return state.events.filter((event) => event.missionId === id);
  }
  async plan(identity: Identity, id: string, change: string | null = null) {
    const before = await this.get(identity, id);
    if (
      before.taskId &&
      activeStates.includes(
        (await this.getTask(identity, before.taskId)).status,
      )
    )
      throw new RelayError(
        409,
        "active_task",
        "Cancel the active simulated task before replanning.",
      );
    const expectedVersion = before.receipt?.version ?? 0;
    const deadline = AbortSignal.timeout(180000);
    try {
      let snapshot = await this.data.snapshot(identity, deadline);
      const memory = this.memory.recall(identity, before.request.destination);
      const buildCandidates = () =>
        enumerateCandidates(
          snapshot.fixtures,
          before.request,
          snapshot.evidence.map((evidence) => evidence.id),
          (Date.parse(before.deadlineAt) - this.clock()) / 60000,
        );
      const result = await reason(
        this.generator,
        { request: before.request, candidates: buildCandidates(), memory },
        async () => {
          snapshot = await this.data.snapshot(identity, deadline);
          return buildCandidates();
        },
        deadline,
      );
      const now = this.clock();
      const receipt: Receipt = {
        schemaVersion: "1.0",
        version: expectedVersion + 1,
        digest: "",
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(
          Math.min(now + this.ttlSeconds * 1000, Date.parse(before.deadlineAt)),
        ).toISOString(),
        mode: this.mode,
        sourceFingerprint: snapshot.fingerprint,
        memoryRevision: memory.revision,
        memory,
        candidates: result.candidates,
        selectedId: result.proposal.candidateId,
        alternatives: alternatives(
          result.candidates,
          before.request,
          (Date.parse(before.deadlineAt) - now) / 60000,
        ),
        evidence: snapshot.evidence,
        steps: result.steps,
        summary: result.proposal.summary,
        change,
      };
      receipt.digest = hash(receipt);
      return await this.store.transact((state) => {
        const mission = ownedMission(state, id, identity);
        if (
          (mission.receipt?.version ?? 0) !== expectedVersion ||
          (mission.taskId &&
            activeStates.includes(state.tasks[mission.taskId].status))
        )
          throw new RelayError(
            409,
            "concurrent_change",
            "Mission changed while planning; reload it.",
          );
        mission.receipt = receipt;
        mission.status = receipt.selectedId
          ? "awaiting_approval"
          : "infeasible";
        mission.error = null;
        addEvent(
          state,
          id,
          this.mode,
          "memory_retrieved",
          { records: memory.records, engine: memory.engine },
          now,
        );
        for (const step of receipt.steps)
          addEvent(
            state,
            id,
            this.mode,
            "agent_step",
            { ...step, planVersion: receipt.version },
            now,
          );
        addEvent(
          state,
          id,
          this.mode,
          "plan_created",
          {
            version: receipt.version,
            digest: receipt.digest,
            selectedId: receipt.selectedId,
            evidence: receipt.evidence,
            change,
          },
          now,
        );
        return mission;
      });
    } catch (error) {
      if (error instanceof RelayError && error.status === 409) throw error;
      await this.store.transact((state) => {
        const mission = ownedMission(state, id, identity);
        if (
          (mission.receipt?.version ?? 0) === expectedVersion &&
          !mission.taskId
        ) {
          mission.status = "dependency_unavailable";
          mission.error =
            error instanceof RelayError
              ? error.message
              : "Unable to validate dependency output.";
          addEvent(state, id, this.mode, "planning_failed", {
            code:
              error instanceof RelayError
                ? error.code
                : "invalid_dependency_output",
            message: mission.error,
          });
        }
      });
      throw error instanceof RelayError
        ? error
        : new RelayError(
            503,
            "invalid_dependency_output",
            "Unable to validate dependency output.",
          );
    }
  }
  private replay(
    state: State,
    identity: Identity,
    key: string,
    signature: string,
  ) {
    const existing = state.idempotency[`${ownerKey(identity)}:${key}`];
    if (!existing) return null;
    if (existing.signature !== signature)
      throw new RelayError(
        409,
        "idempotency_conflict",
        "This idempotency key was already used with different approval terms.",
      );
    return state.tasks[existing.taskId];
  }
  async requestDispatch(
    identity: Identity,
    missionId: string,
    version: number,
    digest: string,
    idempotencyKey: string,
  ) {
    const signature = hash([missionId, version, digest]);
    const initial = await this.store.read();
    const mission = ownedMission(initial, missionId, identity);
    const replay = this.replay(initial, identity, idempotencyKey, signature);
    if (replay) {
      await this.drainOutbox();
      return this.getTask(identity, replay.id);
    }
    if (
      mission.taskId &&
      activeStates.includes(initial.tasks[mission.taskId].status)
    )
      throw new RelayError(
        409,
        "active_task",
        "This mission already has an active dispatch task.",
      );
    const receipt = mission.receipt;
    if (!receipt || receipt.version !== version || receipt.digest !== digest)
      throw new RelayError(
        409,
        "stale_plan",
        "Approve the current plan version.",
      );
    if (!receipt.selectedId || mission.status !== "awaiting_approval")
      throw new RelayError(
        409,
        "invalid_state",
        "This mission has no approvable plan.",
      );
    const snapshot = await this.data.snapshot(identity);
    const memory = this.memory.recall(identity, mission.request.destination);
    const refreshed = enumerateCandidates(
      snapshot.fixtures,
      mission.request,
      [],
      (Date.parse(mission.deadlineAt) - this.clock()) / 60000,
    ).find((candidate) => candidate.id === receipt.selectedId);
    if (
      Date.parse(receipt.expiresAt) <= this.clock() ||
      snapshot.fingerprint !== receipt.sourceFingerprint ||
      memory.revision !== receipt.memoryRevision ||
      !refreshed?.feasible
    ) {
      await this.plan(
        identity,
        missionId,
        "The proposal expired or stock, route, courier availability, or entrance instructions changed. Fresh approval is required.",
      );
      throw new RelayError(
        409,
        "plan_replaced",
        "Evidence changed or the plan expired. Review and approve the replacement.",
      );
    }
    const now = this.clock();
    const task = await this.store.transact((state) => {
      const current = ownedMission(state, missionId, identity);
      const existing = this.replay(state, identity, idempotencyKey, signature);
      if (existing) return existing;
      if (
        current.receipt?.digest !== digest ||
        current.status !== "awaiting_approval" ||
        Date.parse(current.receipt.expiresAt) <= this.clock()
      )
        throw new RelayError(
          409,
          "stale_plan",
          "The approved plan is no longer current.",
        );
      if (
        this.memory.recall(identity, current.request.destination).revision !==
        receipt.memoryRevision
      )
        throw new RelayError(
          409,
          "memory_changed",
          "Entrance instructions changed during approval; replan.",
        );
      if (
        this.mode === "offline_sample" &&
        hash(state.fixtures) !== snapshot.fingerprint
      )
        throw new RelayError(
          409,
          "source_changed",
          "Sources changed during approval; replan.",
        );
      const courier = state.fixtures.couriers.find(
        (courier) => courier.id === refreshed.courier.id,
      );
      // In live-sponsor mode the public simulator reserves a local shadow
      // courier by source ID; it never writes to a real provider system.
      if (this.mode === "live_sponsors" && !courier)
        state.fixtures.couriers.push({ ...refreshed.courier });
      const reservable = state.fixtures.couriers.find(
        (courier) => courier.id === refreshed.courier.id,
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
      reservable.available = false;
      reservable.version++;
      state.fixtures.revision++;
      const task: Task = {
        id: randomUUID(),
        missionId,
        owner: identity,
        planVersion: version,
        planDigest: digest,
        courierId: refreshed.courier.id,
        supplierId: refreshed.supplier.id,
        status: "queued",
        createdAt: new Date(now).toISOString(),
        entrance: memory.entrance,
        idempotencyKey,
      };
      state.tasks[task.id] = task;
      current.taskId = task.id;
      current.status = "queued";
      state.idempotency[`${ownerKey(identity)}:${idempotencyKey}`] = {
        signature,
        taskId: task.id,
      };
      state.outbox.push({
        id: randomUUID(),
        taskId: task.id,
        delivered: false,
      });
      addEvent(
        state,
        missionId,
        this.mode,
        "dispatch_committed",
        {
          taskId: task.id,
          approvedVersion: version,
          planDigest: digest,
          simulated: true,
        },
        now,
      );
      return task;
    });
    await this.drainOutbox();
    return this.getTask(identity, task.id);
  }
  async drainOutbox() {
    await this.store.transact((state) => {
      for (const message of state.outbox.filter(
        (message) => !message.delivered,
      )) {
        const task = state.tasks[message.taskId];
        if (task.status === "queued") {
          task.status = "dispatch_requested";
          state.missions[task.missionId].status = task.status;
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
  async getTask(identity: Identity, taskId: string) {
    const task = (await this.store.read()).tasks[taskId];
    if (!task || !sameOwner(task.owner, identity))
      throw new RelayError(404, "not_found", "Task not found.");
    return task;
  }
  async cancelTask(identity: Identity, taskId: string) {
    return this.transition(identity, taskId, "cancelled");
  }
  async transition(identity: Identity, taskId: string, status: TaskStatus) {
    const allowed: Partial<Record<TaskStatus, TaskStatus[]>> = {
      queued: ["cancelled"],
      dispatch_requested: ["accepted", "declined", "cancelled"],
      accepted: ["in_progress", "cancelled"],
      in_progress: ["completed", "cancelled"],
    };
    const task = await this.store.transact((state) => {
      const task = state.tasks[taskId];
      if (!task || !sameOwner(task.owner, identity))
        throw new RelayError(404, "not_found", "Task not found.");
      if (task.status === status) return task;
      if (!allowed[task.status]?.includes(status))
        throw new RelayError(
          409,
          "invalid_transition",
          `Cannot change ${task.status} to ${status}.`,
        );
      task.status = status;
      state.missions[task.missionId].status = status;
      if (["completed", "declined", "cancelled"].includes(status)) {
        const courier = state.fixtures.couriers.find(
          (courier) => courier.id === task.courierId,
        );
        if (courier) {
          courier.available = status !== "declined";
          courier.version++;
          state.fixtures.revision++;
        }
      }
      addEvent(
        state,
        task.missionId,
        this.mode,
        `simulated_${status}`,
        { taskId, status },
        this.clock(),
      );
      return task;
    });
    if (status === "declined")
      await this.plan(
        identity,
        task.missionId,
        "The simulated courier declined. Review a fresh proposal before dispatching again.",
      );
    return task;
  }
}
