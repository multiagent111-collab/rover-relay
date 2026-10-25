import type { ApprovedExecutionIntent } from "./execution-contract.ts";
import { z } from "zod";
import type { Intake } from "./intake.ts";
import type { ActionRecord } from "./coordinator.ts";
import type { PlanningBudget } from "./budget.ts";
import type { Proposal, ReviewIssue } from "./review.ts";
import type { RuntimeRoute } from "./runtime-proof.ts";
import type { PlanChange } from "./changes.ts";

export const requestSchema = z
  .object({
    sku: z.enum(["HDMI-USB-C"]).default("HDMI-USB-C"),
    quantity: z.number().int().min(1).max(20),
    destination: z.enum(["auditorium", "library"]),
    budgetCents: z.number().int().min(0).max(1000000),
    deadlineMinutes: z.number().int().min(1).max(240),
  })
  .strict();
export type MissionRequest = z.infer<typeof requestSchema>;
export type Identity = { tenant: string; user: string };
export type Mode = "offline_sample" | "live_sponsors";
export type Node = { id: string; name: string; x: number; y: number };
export type Edge = {
  id: string;
  from: string;
  to: string;
  minutes: number;
  closed: boolean;
  version?: number;
};
export type Supplier = {
  id: string;
  name: string;
  sku: string;
  stock: number;
  unitPriceCents: number;
  pickupNode: string;
  handlingMinutes: number;
  version: number;
};
export type Courier = {
  id: string;
  name: string;
  node: string;
  deliveryCents: number;
  available: boolean;
  version: number;
  capacity: number;
  supplierId: string;
};
export type Fixtures = {
  revision: number;
  suppliers: Supplier[];
  couriers: Courier[];
  edges: Edge[];
  nodes: Node[];
};
// Additive fields preserve stored 1.0 receipts; newly generated observations
// include kind, facts, content hash and provenance. Legacy records cannot satisfy
// the new candidate coverage check without a fresh source snapshot.
export const evidenceSchema = z
  .object({
    id: z.string().min(1).max(200),
    source: z.string().min(1).max(200),
    recordId: z.string().min(1).max(200),
    sourceVersion: z.string().min(1).max(200),
    fetchedAt: z.string().datetime({ offset: true }),
    observedAt: z.string().datetime({ offset: true }).optional(),
    mode: z.enum(["offline_sample", "live_sponsors"]),
    queryId: z.string().max(200).optional(),
    kind: z.enum(["supplier", "courier", "route_edge"]).optional(),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    facts: z
      .record(
        z.string(),
        z.union([z.string().max(200), z.number().finite(), z.boolean()]),
      )
      .optional(),
    provenance: z.literal("application_projection").optional(),
  })
  .strict();
export type Evidence = z.infer<typeof evidenceSchema>;
export type Check = { code: string; passed: boolean; detail: string };
export type Candidate = {
  id: string;
  supplier: Supplier;
  courier: Courier;
  routeEdges: string[];
  routeNodes: string[];
  travelMinutes: number;
  totalCents: number;
  checks: Check[];
  feasible: boolean;
  evidenceIds: string[];
};
export type MemoryContext = {
  records: { id: string; content: string; relevance: number }[];
  context: string;
  entrance: string | null;
  revision: string;
  engine: string;
};
export type Snapshot = {
  fixtures: Fixtures;
  evidence: Evidence[];
  fingerprint: string;
  fetchedAt: string;
};
export type AgentStep = {
  role: "Planner" | "Critic" | "Validator";
  round: number;
  decision: string;
  candidateId?: string | null;
  feedback?: string[];
  issues?: ReviewIssue[];
  provider: string;
  memoryIds: string[];
  requestId?: string;
  model?: string;
  routing?: RuntimeRoute;
};
export type Receipt = {
  schemaVersion: "1.0";
  version: number;
  digest: string;
  createdAt: string;
  expiresAt: string;
  mode: Mode;
  sourceFingerprint: string;
  memoryRevision: string;
  memory: MemoryContext;
  candidates: Candidate[];
  selectedId: string | null;
  alternatives: {
    budgetIncreaseCents: number | null;
    deadlineExtensionMinutes: number | null;
    status?:
      | "within_constraints"
      | "no_available_option"
      | "combined_change_required"
      | "either_change"
      | "increase_budget"
      | "extend_deadline";
    explanation?: string;
  };
  evidence: Evidence[];
  steps: AgentStep[];
  summary: string;
  review?: {
    contractVersion: "proposal-2.0";
    terms: Proposal["terms"];
    commitment: "uncommitted";
    repairsUsed: number;
  };
  change: string | null;
  changeDetails?: PlanChange;
  coordination?: {
    actions: ActionRecord[];
    budget: ReturnType<PlanningBudget["usage"]>;
    policy: "observation-guided";
  };
};
export type TaskStatus =
  | "queued"
  | "dispatch_requested"
  | "accepted"
  | "in_progress"
  | "completed"
  | "declined"
  | "cancelled";
export type Task = {
  id: string;
  missionId: string;
  owner: Identity;
  planVersion: number;
  planDigest: string;
  courierId: string;
  supplierId: string;
  status: TaskStatus;
  createdAt: string;
  entrance: string | null;
  idempotencyKey: string;
  revision?: number;
  execution?: {
    backend: "simulator" | "http_gateway";
    intentId: string;
    jobId?: string;
    rejectionCode?: string;
    stateDigest?: string;
  };
  cancellation?: {
    requestedAt: string;
    confirmedAt: string | null;
    backend: "simulator" | "http_gateway";
    requestRevision?: number;
  };
};
export type Mission = {
  id: string;
  owner: Identity;
  request: MissionRequest;
  createdAt: string;
  deadlineAt: string;
  status:
    | "planning"
    | "awaiting_approval"
    | "infeasible"
    | "dependency_unavailable"
    | TaskStatus;
  receipt: Receipt | null;
  taskId: string | null;
  error: string | null;
};
export type Event = {
  id: string;
  missionId: string;
  sequence: number;
  type: string;
  timestamp: string;
  mode: Mode;
  data: Record<string, unknown>;
};
export type State = {
  schemaVersion: 1;
  fixtures: Fixtures;
  missions: Record<string, Mission>;
  tasks: Record<string, Task>;
  events: Event[];
  outbox: { id: string; taskId: string; delivered: boolean }[];
  idempotency: Record<string, { signature: string; taskId: string }>;
  intakes?: Record<string, Intake>;
  executionIntents?: Record<string, ApprovedExecutionIntent>;
};
export type Store = {
  read(): Promise<State>;
  transact<T>(fn: (state: State) => T): Promise<T>;
  close(): Promise<void>;
};
export interface DataPort {
  snapshot(identity: Identity, signal?: AbortSignal): Promise<Snapshot>;
}
export interface DispatchPort {
  requestDispatch(
    identity: Identity,
    missionId: string,
    version: number,
    digest: string,
    idempotencyKey: string,
  ): Promise<Task>;
  getTask(identity: Identity, taskId: string): Promise<Task>;
  cancelTask(identity: Identity, taskId: string): Promise<Task>;
}

export class RelayError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
