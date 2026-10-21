import { createHash, randomUUID } from "node:crypto";
import type {
  Candidate,
  Event,
  Fixtures,
  Identity,
  MissionRequest,
  Mode,
  State,
} from "./types.ts";
import { RelayError } from "./types.ts";

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

export function shortestPath(fixtures: Fixtures, from: string, to: string) {
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
  evidenceIds: string[],
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
          const checks = [
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
            routeEdges: [...(pickup?.edges ?? []), ...(delivery?.edges ?? [])],
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
) {
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
  return {
    budgetIncreaseCents: onTime.length
      ? Math.max(
          0,
          Math.min(...onTime.map((candidate) => candidate.totalCents)) -
            request.budgetCents,
        )
      : null,
    deadlineExtensionMinutes: affordable.length
      ? Math.max(
          0,
          Math.ceil(
            Math.min(
              ...affordable.map((candidate) => candidate.travelMinutes),
            ) - remainingMinutes,
          ),
        )
      : null,
  };
}
