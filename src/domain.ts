import { createHash, randomUUID } from "node:crypto";
import type {
  Candidate,
  Event,
  Fixtures,
  Identity,
  MissionRequest,
  Mode,
  State,
  Evidence,
  Receipt,
} from "./types.ts";
import { RelayError } from "./types.ts";
import { edgeFacts, matchesObservation } from "./evidence.ts";

export const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const sameOwner = (a: Identity, b: Identity) =>
  a.tenant === b.tenant && a.user === b.user;
export const ownerKey = (owner: Identity) => hash([owner.tenant, owner.user]);
export function ownedMission(state: State, id: string, owner: Identity) {
  const mission = state.missions[id];
  if (!mission || !sameOwner(mission.owner, owner))
    throw new RelayError(404, "not_found", "Mission not found.");
  return mission;
}
export function addEvent(
  state: State,
  missionId: string,
  mode: Mode,
  type: string,
  data: Record<string, unknown>,
  now = Date.now(),
): Event {
  const sequence =
    state.events.filter((event) => event.missionId === missionId).length + 1;
  const event = {
    id: randomUUID(),
    missionId,
    sequence,
    type,
    timestamp: new Date(now).toISOString(),
    mode,
    data,
  };
  state.events.push(event);
  return event;
}

export function shortestPath(
  fixtures: Pick<Fixtures, "edges">,
  from: string,
  to: string,
) {
  const distances = new Map([[from, 0]]);
  const previous = new Map<string, { node: string; edge: string }>();
  const visited = new Set<string>();
  while (true) {
    const current = [...distances]
      .filter(([id]) => !visited.has(id))
      .sort((a, b) => a[1] - b[1])[0];
    if (!current) return null;
    const [node, distance] = current;
    if (node === to) {
      const edges: string[] = [],
        nodes = [to];
      let cursor = to;
      while (cursor !== from) {
        const p = previous.get(cursor)!;
        edges.unshift(p.edge);
        nodes.unshift(p.node);
        cursor = p.node;
      }
      return { minutes: distance, edges, nodes };
    }
    visited.add(node);
    for (const edge of fixtures.edges.filter(
      (edge) => !edge.closed && (edge.from === node || edge.to === node),
    )) {
      const neighbor = edge.from === node ? edge.to : edge.from;
      const next = distance + edge.minutes;
      if (next < (distances.get(neighbor) ?? Infinity)) {
        distances.set(neighbor, next);
        previous.set(neighbor, { node, edge: edge.id });
      }
    }
  }
}

export function enumerateCandidates(
  fixtures: Fixtures,
  request: MissionRequest,
  evidence: Evidence[],
  remainingMinutes = request.deadlineMinutes,
): Candidate[] {
  return fixtures.suppliers
    .flatMap((supplier) =>
      fixtures.couriers
        .filter((courier) => courier.supplierId === supplier.id)
        .map((courier) => {
          const pickup = shortestPath(
            fixtures,
            courier.node,
            supplier.pickupNode,
          );
          const delivery = shortestPath(
            fixtures,
            supplier.pickupNode,
            request.destination,
          );
          const travelMinutes =
            pickup && delivery
              ? pickup.minutes + supplier.handlingMinutes + delivery.minutes
              : 100000;
          const totalCents =
            supplier.unitPriceCents * request.quantity + courier.deliveryCents;
          const routeEdges = [
            ...new Set([...(pickup?.edges ?? []), ...(delivery?.edges ?? [])]),
          ];
          // Proving absence of an open path needs the complete observed graph.
          const requiredEdges =
            pickup && delivery
              ? fixtures.edges.filter((edge) => routeEdges.includes(edge.id))
              : fixtures.edges;
          const required = [
            evidence.find((item) =>
              matchesObservation(
                item,
                "supplier",
                supplier.id,
                String(supplier.version),
                supplier,
              ),
            ),
            evidence.find((item) =>
              matchesObservation(
                item,
                "courier",
                courier.id,
                String(courier.version),
                courier,
              ),
            ),
            ...requiredEdges.map((edge) =>
              evidence.find((item) =>
                matchesObservation(
                  item,
                  "route_edge",
                  edge.id,
                  String(edge.version ?? fixtures.revision),
                  edgeFacts(edge),
                ),
              ),
            ),
          ];
          const evidenceIds = [
            ...new Set(
              required
                .filter((item): item is Evidence => !!item)
                .map((item) => item.id),
            ),
          ];
          const checks = [
            {
              code: "evidence",
              passed: required.every(Boolean),
              detail:
                "Required supplier, courier and route observations must match the checked facts.",
            },
            {
              code: "sku",
              passed: supplier.sku === request.sku,
              detail: "Exact USB-C to HDMI compatibility required.",
            },
            {
              code: "stock",
              passed: supplier.stock >= request.quantity,
              detail: `${supplier.stock} observed; ${request.quantity} requested. Inventory is not reserved.`,
            },
            {
              code: "courier",
              passed: courier.available,
              detail: courier.available
                ? "Courier available in source."
                : "Courier unavailable.",
            },
            {
              code: "capacity",
              passed: courier.capacity >= request.quantity,
              detail: `Courier capacity ${courier.capacity} items.`,
            },
            {
              code: "route",
              passed: Boolean(pickup && delivery),
              detail:
                pickup && delivery
                  ? "Open route to pickup and destination."
                  : "No open route.",
            },
            {
              code: "budget",
              passed: totalCents <= request.budgetCents,
              detail: `$${(totalCents / 100).toFixed(2)} estimated including delivery; synthetic fees/tax $0.`,
            },
            {
              code: "deadline",
              passed: travelMinutes <= remainingMinutes,
              detail: `${travelMinutes === 100000 ? "Unknown" : travelMinutes} min needed; ${Math.max(0, Math.floor(remainingMinutes))} min remaining.`,
            },
          ];
          return {
            id: `${supplier.id}:${courier.id}`,
            supplier,
            courier,
            routeEdges,
            routeNodes: [
              ...(pickup?.nodes ?? []),
              ...(delivery?.nodes.slice(1) ?? []),
            ],
            travelMinutes,
            totalCents,
            checks,
            feasible: checks.every((check) => check.passed),
            evidenceIds,
          };
        }),
    )
    .sort(
      (a, b) =>
        a.totalCents - b.totalCents ||
        a.travelMinutes - b.travelMinutes ||
        a.id.localeCompare(b.id),
    );
}

export function alternatives(
  candidates: Candidate[],
  request: MissionRequest,
  remainingMinutes: number,
): Required<Receipt["alternatives"]> {
  const structurallyValid = candidates.filter((candidate) =>
    candidate.checks
      .filter((check) => !["budget", "deadline"].includes(check.code))
      .every((check) => check.passed),
  );
  const onTime = structurallyValid.filter(
    (candidate) => candidate.travelMinutes <= remainingMinutes,
  );
  const affordable = structurallyValid.filter(
    (candidate) => candidate.totalCents <= request.budgetCents,
  );
  const budgetIncreaseCents = onTime.length
    ? Math.max(
        0,
        Math.min(...onTime.map((c) => c.totalCents)) - request.budgetCents,
      )
    : null;
  const deadlineExtensionMinutes = affordable.length
    ? Math.max(
        0,
        Math.ceil(
          Math.min(...affordable.map((c) => c.travelMinutes)) -
            remainingMinutes,
        ),
      )
    : null;
  const status = candidates.some((c) => c.feasible)
    ? "within_constraints"
    : !structurallyValid.length
      ? "no_available_option"
      : budgetIncreaseCents === null && deadlineExtensionMinutes === null
        ? "combined_change_required"
        : budgetIncreaseCents !== null && deadlineExtensionMinutes !== null
          ? "either_change"
          : budgetIncreaseCents !== null
            ? "increase_budget"
            : "extend_deadline";
  const explanation = {
    within_constraints:
      "A checked option meets the current constraints; review its terms before approval.",
    no_available_option:
      "Neither extra budget alone nor extra time alone fixes the current stock, courier, compatibility or route constraints.",
    combined_change_required:
      "Neither extra budget alone nor extra time alone is sufficient. Available options require both changes; a new confirmed request is needed.",
    either_change:
      "Separate checked options can work with extra budget alone or extra time alone. Review the computed alternatives; current constraints are unchanged.",
    increase_budget:
      "The minimum extra budget is computed only from on-time options. Extra time alone cannot satisfy the current budget.",
    extend_deadline:
      "The minimum extra time is computed only from within-budget options. Extra budget alone cannot meet the original deadline.",
  }[status];
  return {
    budgetIncreaseCents,
    deadlineExtensionMinutes,
    status,
    explanation,
  };
}
