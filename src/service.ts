import {
  activeExecutionStates as activeStates,
  type ExecutionAdapter,
} from "./execution.ts";
import { SimulatorExecutor } from "./adapters/simulator.ts";
import { parseExecutionIntent } from "./execution-contract.ts";
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
import { receiptSummary } from "./review.ts";
import { describeChange } from "./changes.ts";
import { newestFirst } from "./order.ts";
import { PlanningBudget } from "./budget.ts";
import {
  coordinate,
  observationPolicy,
  type DecisionAdapter,
  type ActionRecord,
} from "./coordinator.ts";
import {
  clarify,
  extractDraft,
  intakeCreateSchema,
  intakeUpdateSchema,
  intakeConfirmSchema,
  intakeFields,
  type Intake,
} from "./intake.ts";
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
  type AgentStep,
} from "./types.ts";

export class RelayService implements DispatchPort {
  decision: DecisionAdapter = observationPolicy;
  planningLimits = { inference: 6, tools: 6, timeoutMs: 180000 };
  readonly execution: ExecutionAdapter;
  constructor(
    public store: Store,
    public data: DataPort,
    public generator: Generator,
    public memory: MemoryAdapter,
    public mode: Mode,
    private ttlSeconds = 60,
    private clock = Date.now,
    execution?: ExecutionAdapter,
  ) {
    this.execution = execution ?? new SimulatorExecutor(store, mode, clock);
  }
  async create(identity: Identity, input: unknown, signal?: AbortSignal) {
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
    return this.plan(identity, mission.id, null, signal);
  }
  private ownedIntake(state: State, id: string, identity: Identity): Intake {
    const intake = state.intakes?.[id];
    if (!intake || !sameOwner(intake.owner, identity))
      throw new RelayError(404, "not_found", "Draft not found.");
    return intake;
  }
  async getIntake(identity: Identity, id: string) {
    return this.ownedIntake(await this.store.read(), id, identity);
  }
  async listIntakes(identity: Identity) {
    return Object.values((await this.store.read()).intakes || {})
      .filter((i) => sameOwner(i.owner, identity) && i.status === "needs_input")
      .sort(newestFirst);
  }
  async createIntake(identity: Identity, input: unknown) {
    const { text } = intakeCreateSchema.parse(input);
    const extracted = extractDraft(text);
    const now = this.clock(),
      id = randomUUID();
    const intake: Intake = {
      schemaVersion: "intake-1.0",
      id,
      missionId: id,
      owner: identity,
      createdAt: new Date(now).toISOString(),
      deadlineAt:
        extracted.fields.deadlineMinutes === undefined
          ? null
          : new Date(
              now + extracted.fields.deadlineMinutes * 60000,
            ).toISOString(),
      status: "needs_input",
      revision: 1,
      text,
      ...extracted,
    };
    await this.store.transact((state) => {
      (state.intakes ??= {})[id] = intake;
      addEvent(
        state,
        id,
        this.mode,
        "intake_created",
        {
          revision: 1,
          action: {
            type: "ask_user",
            fields: intake.questions.length
              ? intake.questions.map((q) => q.field)
              : [...intakeFields],
          },
          confirmationRequired: true,
        },
        now,
      );
    });
    return intake;
  }
  async updateIntake(identity: Identity, id: string, input: unknown) {
    const body = intakeUpdateSchema.parse(input);
    return this.store.transact((state) => {
      const intake = this.ownedIntake(state, id, identity);
      if (intake.status !== "needs_input" || intake.revision !== body.revision)
        throw new RelayError(
          409,
          "stale_draft",
          "Reload the current draft revision before editing.",
        );
      const extracted =
        body.text === undefined
          ? { fields: {}, conflicts: [] as Intake["conflicts"] }
          : extractDraft(body.text);
      const fields = { ...intake.fields, ...extracted.fields, ...body.fields };
      const resolved = new Set(
        Object.keys({ ...extracted.fields, ...body.fields }),
      );
      const conflicts = [
        ...new Set([
          ...intake.conflicts.filter((field) => !resolved.has(field)),
          ...extracted.conflicts.filter(
            (field) => body.fields?.[field] === undefined,
          ),
        ]),
      ];
      for (const field of conflicts) delete fields[field];
      const deadlineAt =
        fields.deadlineMinutes === undefined
          ? intake.deadlineAt
          : new Date(
              Date.parse(intake.createdAt) + fields.deadlineMinutes * 60000,
            ).toISOString();
      if (
        intake.deadlineAt &&
        deadlineAt &&
        Date.parse(deadlineAt) > Date.parse(intake.deadlineAt)
      )
        throw new RelayError(
          409,
          "deadline_locked",
          "The original deadline cannot be extended by waiting or editing. Start a new request for a later deadline.",
        );
      Object.assign(intake, {
        fields,
        conflicts,
        questions: clarify(fields, conflicts),
        deadlineAt,
        revision: intake.revision + 1,
        ...(body.text === undefined ? {} : { text: body.text }),
      });
      addEvent(
        state,
        id,
        this.mode,
        "intake_updated",
        {
          revision: intake.revision,
          action: {
            type: "ask_user",
            fields: intake.questions.length
              ? intake.questions.map((q) => q.field)
              : [...intakeFields],
          },
          confirmationRequired: true,
        },
        this.clock(),
      );
      return intake;
    });
  }
  async confirmIntake(
    identity: Identity,
    id: string,
    input: unknown,
    signal?: AbortSignal,
  ) {
    const body = intakeConfirmSchema.parse(input);
    const fresh = await this.store.transact((state) => {
      const intake = this.ownedIntake(state, id, identity);
      if (intake.status === "confirmed") {
        if (intake.confirmedRequestHash !== hash(body.request))
          throw new RelayError(
            409,
            "confirmation_conflict",
            "This draft was already confirmed with different terms.",
          );
        return false;
      }
      if (intake.revision !== body.revision)
        throw new RelayError(
          409,
          "stale_draft",
          "Confirm the displayed current draft revision.",
        );
      if (
        intake.questions.length ||
        hash(body.request) !== hash(requestSchema.parse(intake.fields))
      )
        throw new RelayError(
          409,
          "needs_input",
          "Review and resolve every required field before confirming these exact constraints.",
        );
      if (!intake.deadlineAt || Date.parse(intake.deadlineAt) <= this.clock())
        throw new RelayError(
          409,
          "deadline_elapsed",
          "The original operational deadline has elapsed. Start a new request; waiting does not reset it.",
        );
      state.missions[id] = {
        id,
        owner: identity,
        request: body.request,
        createdAt: intake.createdAt,
        deadlineAt: intake.deadlineAt,
        status: "planning",
        receipt: null,
        taskId: null,
        error: null,
      };
      intake.status = "confirmed";
      intake.confirmedRequestHash = hash(body.request);
      addEvent(
        state,
        id,
        this.mode,
        "mission_confirmed",
        {
          revision: intake.revision,
          request: body.request,
          originalDeadlineAt: intake.deadlineAt,
        },
        this.clock(),
      );
      return true;
    });
    return fresh
      ? this.plan(identity, id, null, signal)
      : this.get(identity, id);
  }
  async get(identity: Identity, id: string) {
    return ownedMission(await this.store.read(), id, identity);
  }
  async list(identity: Identity) {
    return Object.values((await this.store.read()).missions)
      .filter((mission) => sameOwner(mission.owner, identity))
      .sort(newestFirst);
  }
  async events(identity: Identity, id: string) {
    const state = await this.store.read();
    ownedMission(state, id, identity);
    return state.events.filter((event) => event.missionId === id);
  }
  async plan(
    identity: Identity,
    id: string,
    change: string | null = null,
    signal?: AbortSignal,
  ) {
    const planningState = await this.store.read();
    const before = ownedMission(planningState, id, identity);
    if (
      before.taskId &&
      activeStates.includes(planningState.tasks[before.taskId].status)
    )
      throw new RelayError(
        409,
        "active_task",
        "Cancel the active simulated task before replanning.",
      );
    const expectedVersion = before.receipt?.version ?? 0;
    const declined = new Set(
      Object.values(planningState.tasks)
        .filter(
          (task) =>
            task.missionId === id &&
            sameOwner(task.owner, identity) &&
            task.status === "declined" &&
            !task.execution?.rejectionCode,
        )
        .map((task) => task.courierId),
    );
    const budget = new PlanningBudget(this.planningLimits, signal);
    const actions: ActionRecord[] = [];
    const reviewSteps: AgentStep[] = [];
    const deadline = budget.signal;
    try {
      let snapshot = await coordinate(
        this.data,
        identity,
        before.request,
        budget,
        actions,
        this.decision,
      );
      const memory = this.memory.recall(identity, before.request.destination);
      const buildCandidates = () =>
        enumerateCandidates(
          snapshot.fixtures,
          before.request,
          snapshot.evidence,
          (Date.parse(before.deadlineAt) - this.clock()) / 60000,
        ).map((candidate) => {
          const check = {
            code: "prior_decline",
            passed: !declined.has(candidate.courier.id),
            detail:
              "A courier that declined this mission requires a different provider proposal.",
          };
          return {
            ...candidate,
            checks: [...candidate.checks, check],
            feasible: candidate.feasible && check.passed,
          };
        });
      const result = await reason(
        {
          generate: (role, input) =>
            budget.inference(() =>
              this.generator.generate(role, input, deadline),
            ),
        },
        { request: before.request, candidates: buildCandidates(), memory },
        async () => {
          snapshot = await coordinate(
            this.data,
            identity,
            before.request,
            budget,
            actions,
            this.decision,
          );
          return buildCandidates();
        },
        deadline,
        (step) => reviewSteps.push(step),
      );
      budget.check();
      const now = this.clock();
      const suggestions = alternatives(
        result.candidates,
        before.request,
        (Date.parse(before.deadlineAt) - now) / 60000,
      );
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
        alternatives: suggestions,
        evidence: snapshot.evidence,
        steps: result.steps,
        summary:
          receiptSummary(
            before.request,
            result.candidates.find((c) => c.id === result.proposal.candidateId),
          ) +
          (result.proposal.candidateId === null
            ? ` ${suggestions.explanation}`
            : ""),
        review: {
          contractVersion: result.proposal.contractVersion,
          terms: result.proposal.terms,
          commitment: result.proposal.commitment,
          repairsUsed: Math.max(...result.steps.map((step) => step.round)) - 1,
        },
        change,
        coordination: {
          actions,
          budget: budget.usage(),
          policy: "observation-guided",
        },
      };
      const previousTask = before.taskId
        ? planningState.tasks[before.taskId]
        : undefined;
      receipt.changeDetails = describeChange(
        before,
        receipt,
        now,
        previousTask?.planVersion === before.receipt?.version
          ? previousTask?.status
          : undefined,
      );
      receipt.digest = hash(receipt);
      return await this.store.transact((state) => {
        budget.check();
        const mission = ownedMission(state, id, identity);
        if (
          (mission.receipt?.version ?? 0) !== expectedVersion ||
          mission.taskId !== before.taskId ||
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
        for (const entry of actions)
          addEvent(
            state,
            id,
            this.mode,
            "coordinator_action",
            { ...entry, planVersion: receipt.version },
            now,
          );
        addEvent(state, id, this.mode, "planning_budget", budget.usage(), now);
        addEvent(
          state,
          id,
          this.mode,
          "memory_retrieved",
          {
            recordIds: memory.records.map((record) => record.id),
            revision: memory.revision,
            engine: memory.engine,
          },
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
            changeDetails: receipt.changeDetails,
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
          mission.taskId === before.taskId &&
          (!mission.taskId ||
            !activeStates.includes(state.tasks[mission.taskId].status))
        ) {
          mission.status = "dependency_unavailable";
          mission.error =
            error instanceof RelayError
              ? error.message
              : "Unable to validate dependency output.";
          for (const entry of actions)
            addEvent(
              state,
              id,
              this.mode,
              "coordinator_action",
              { ...entry },
              this.clock(),
            );
          addEvent(
            state,
            id,
            this.mode,
            "planning_budget",
            budget.usage(),
            this.clock(),
          );
          addEvent(state, id, this.mode, "planning_failed", {
            code:
              error instanceof RelayError
                ? error.code
                : "invalid_dependency_output",
            message: mission.error,
          });
          for (const step of reviewSteps)
            addEvent(
              state,
              id,
              this.mode,
              "agent_step",
              { ...step, failed: true },
              this.clock(),
            );
        }
      });
      throw error instanceof RelayError
        ? error
        : new RelayError(
            503,
            "invalid_dependency_output",
            "Unable to validate dependency output.",
          );
    } finally {
      budget.dispose();
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
    signal?: AbortSignal,
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
    const snapshot = await this.data.snapshot(identity, signal);
    const memory = this.memory.recall(identity, mission.request.destination);
    const refreshed = enumerateCandidates(
      snapshot.fixtures,
      mission.request,
      snapshot.evidence,
      (Date.parse(mission.deadlineAt) - this.clock()) / 60000,
    ).find((candidate) => candidate.id === receipt.selectedId);
    if (
      Date.parse(receipt.expiresAt) <= this.clock() ||
      snapshot.fingerprint !== receipt.sourceFingerprint ||
      memory.revision !== receipt.memoryRevision ||
      !refreshed?.feasible
    ) {
      try {
        await this.plan(
          identity,
          missionId,
          "The proposal expired or stock, route, courier availability, or entrance instructions changed. Fresh approval is required.",
          signal,
        );
      } catch (error) {
        // Another approval can commit between the initial read and the fresh
        // snapshot. Its reservation changes the source fingerprint; replanning
        // then refuses the active task. Resolve only this owner's exact key and
        // original signature, rather than treating that successful retry as a
        // stale plan or allocating a replacement task.
        const latest = await this.store.read();
        ownedMission(latest, missionId, identity);
        const committed = this.replay(
          latest,
          identity,
          idempotencyKey,
          signature,
        );
        if (!committed) throw error;
        await this.drainOutbox();
        return this.getTask(identity, committed.id);
      }
      throw new RelayError(
        409,
        "plan_replaced",
        "Evidence changed or the plan expired. Review and approve the replacement.",
      );
    }
    const now = this.clock();
    const task = await this.store.transact((state) => {
      if (signal?.aborted)
        throw new RelayError(
          503,
          "planning_cancelled",
          "Approval was cancelled before dispatch was committed.",
        );
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
        revision: 1,
      };
      const intent = parseExecutionIntent({
        contractVersion: "1.0",
        intentId: randomUUID(),
        taskId: task.id,
        missionId,
        request: {
          revision: 1,
          digest: hash(requestSchema.parse(current.request)),
        },
        approvedPlan: { version, digest },
        approvedAt: task.createdAt,
        expiresAt: current.receipt.expiresAt,
        executionBackend: this.execution.backend,
        selected: { supplierId: task.supplierId, courierId: task.courierId },
        equipment: {
          sku: current.request.sku,
          quantity: current.request.quantity,
        },
        pickup: { locationId: refreshed.supplier.pickupNode },
        destination: {
          locationId: current.request.destination,
          entrance: memory.entrance,
        },
        money: {
          currency: "USD",
          itemEstimateCents:
            refreshed.supplier.unitPriceCents * current.request.quantity,
          deliveryEstimateCents: refreshed.courier.deliveryCents,
          explicitFeesCents: 0,
          approvedTotalCents: refreshed.totalCents,
        },
        absoluteDeadlineAt: current.deadlineAt,
        sourceFingerprint: receipt.sourceFingerprint,
        memoryRevision: memory.revision,
        evidenceIds: refreshed.evidenceIds,
      });
      task.execution = {
        backend: this.execution.backend,
        intentId: intent.intentId,
      };
      this.execution.stage(state, task, intent, refreshed);
      (state.executionIntents ??= {})[task.id] = intent;
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
          backend: this.execution.backend,
          intentId: intent.intentId,
          simulated: this.execution.backend === "simulator",
        },
        now,
      );
      return task;
    });
    await this.drainOutbox();
    return this.getTask(identity, task.id);
  }
  async drainOutbox() {
    await this.execution.drainOutbox();
  }
  async getTask(identity: Identity, taskId: string) {
    const task = (await this.store.read()).tasks[taskId];
    if (!task || !sameOwner(task.owner, identity))
      throw new RelayError(404, "not_found", "Task not found.");
    if (this.execution.reconcile)
      return this.execution.reconcile(identity, taskId);
    return task;
  }
  async cancelTask(
    identity: Identity,
    taskId: string,
    expectedRevision?: number,
  ) {
    return this.execution.cancelTask(identity, taskId, expectedRevision);
  }
  async transition(
    identity: Identity,
    taskId: string,
    status: TaskStatus,
    signal?: AbortSignal,
    expectedRevision?: number,
  ) {
    if (!this.execution.transition)
      throw new RelayError(
        409,
        "execution_not_simulated",
        "Only the selected execution backend can report provider transitions.",
      );
    const result = await this.execution.transition(
      identity,
      taskId,
      status,
      signal,
      expectedRevision,
    );
    if (result.changed && status === "declined")
      await this.plan(
        identity,
        result.task.missionId,
        "The simulated courier declined. Review a fresh proposal before dispatching again.",
        signal,
      );
    return result.task;
  }
}
