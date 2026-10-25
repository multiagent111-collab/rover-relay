import { contentHash } from "./evidence.ts";
import type { Evidence, Mission, Receipt, TaskStatus } from "./types.ts";

export type ChangeReason =
  | "stock_changed"
  | "supplier_changed"
  | "courier_changed"
  | "route_changed"
  | "price_changed"
  | "eta_changed"
  | "entrance_changed"
  | "source_changed"
  | "plan_expired"
  | "courier_declined"
  | "task_cancelled"
  | "requested_refresh";
type Terms = {
  candidateId: string;
  supplierId: string;
  courierId: string;
  quantity: number;
  unitPriceCents: number;
  deliveryCents: number;
  totalCents: number;
  etaMinutes: number;
  routeEdges: string[];
  entrance: string | null;
};
type Facts = NonNullable<Evidence["facts"]>;
export type PlanChange = {
  schemaVersion: "change-1.0";
  reasons: ChangeReason[];
  previous: { version: number; digest: string; terms: Terms | null };
  current: { version: number; terms: Terms | null };
  sourceChanges: {
    kind: NonNullable<Evidence["kind"]>;
    recordId: string;
    before: Facts | null;
    after: Facts | null;
  }[];
  memory: { beforeRevision: string; afterRevision: string };
  originalDeadlineAt: string;
  confirmationRequired: true;
  operations: "simulated";
};
function terms(receipt: Receipt, quantity: number): Terms | null {
  const chosen = receipt.candidates.find((c) => c.id === receipt.selectedId);
  return chosen
    ? {
        candidateId: chosen.id,
        supplierId: chosen.supplier.id,
        courierId: chosen.courier.id,
        quantity,
        unitPriceCents: chosen.supplier.unitPriceCents,
        deliveryCents: chosen.courier.deliveryCents,
        totalCents: chosen.totalCents,
        etaMinutes: chosen.travelMinutes,
        routeEdges: chosen.routeEdges,
        entrance: receipt.memory.entrance,
      }
    : null;
}
export function describeChange(
  before: Mission,
  current: Receipt,
  now: number,
  previousTaskStatus?: TaskStatus,
): PlanChange | undefined {
  const previous = before.receipt;
  if (!previous) return undefined;
  const reasons = new Set<ChangeReason>();
  const key = (e: Evidence) => `${e.kind}:${e.recordId}`;
  const old = new Map(
    previous.evidence.filter((e) => e.kind && e.facts).map((e) => [key(e), e]),
  );
  const fresh = new Map(
    current.evidence.filter((e) => e.kind && e.facts).map((e) => [key(e), e]),
  );
  const sourceChanges: PlanChange["sourceChanges"] = [];
  for (const id of [...new Set([...old.keys(), ...fresh.keys()])].sort()) {
    const a = old.get(id),
      b = fresh.get(id);
    if (contentHash(a?.facts ?? null) === contentHash(b?.facts ?? null))
      continue;
    const observation = b ?? a!;
    sourceChanges.push({
      kind: observation.kind!,
      recordId: observation.recordId,
      before: a?.facts ?? null,
      after: b?.facts ?? null,
    });
    if (observation.kind === "route_edge") reasons.add("route_changed");
    if (observation.kind === "courier") reasons.add("courier_changed");
    if (observation.kind === "supplier" && a?.facts?.stock !== b?.facts?.stock)
      reasons.add("stock_changed");
    if (
      a?.facts?.unitPriceCents !== b?.facts?.unitPriceCents ||
      a?.facts?.deliveryCents !== b?.facts?.deliveryCents
    )
      reasons.add("price_changed");
  }
  const from = terms(previous, before.request.quantity),
    to = terms(current, before.request.quantity);
  if (from && to) {
    if (from.supplierId !== to.supplierId) reasons.add("supplier_changed");
    if (from.courierId !== to.courierId) reasons.add("courier_changed");
    if (from.totalCents !== to.totalCents) reasons.add("price_changed");
    if (from.etaMinutes !== to.etaMinutes) reasons.add("eta_changed");
    if (contentHash(from.routeEdges) !== contentHash(to.routeEdges))
      reasons.add("route_changed");
  }
  if (previous.memoryRevision !== current.memoryRevision)
    reasons.add("entrance_changed");
  if (
    previous.sourceFingerprint !== current.sourceFingerprint &&
    !sourceChanges.length
  )
    reasons.add("source_changed");
  if (Date.parse(previous.expiresAt) <= now) reasons.add("plan_expired");
  if (before.status === "declined" || previousTaskStatus === "declined")
    reasons.add("courier_declined");
  if (before.status === "cancelled" || previousTaskStatus === "cancelled")
    reasons.add("task_cancelled");
  if (!reasons.size) reasons.add("requested_refresh");
  return {
    schemaVersion: "change-1.0",
    reasons: [...reasons].sort(),
    previous: {
      version: previous.version,
      digest: previous.digest,
      terms: from,
    },
    current: { version: current.version, terms: to },
    sourceChanges,
    memory: {
      beforeRevision: previous.memoryRevision,
      afterRevision: current.memoryRevision,
    },
    originalDeadlineAt: before.deadlineAt,
    confirmationRequired: true,
    operations: "simulated",
  };
}
