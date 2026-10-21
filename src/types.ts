import { z } from "zod";

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
export type Evidence = {
  id: string;
  source: string;
  recordId: string;
  sourceVersion: string;
  fetchedAt: string;
  observedAt?: string;
  mode: Mode;
  queryId?: string;
};
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
  provider: string;
  memoryIds: string[];
  requestId?: string;
  model?: string;
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
  };
  evidence: Evidence[];
  steps: AgentStep[];
  summary: string;
  change: string | null;
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
