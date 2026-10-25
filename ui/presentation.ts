import type { Fixtures, Mission, Receipt } from "../src/types.ts";
import { newestFirst } from "../src/order.ts";

export function visibleMissions(
  missions: Mission[],
  search: string,
  status: string,
) {
  const query = search.trim().toLowerCase();
  return missions
    .filter(
      (m) =>
        (status === "all" || m.status === status) &&
        `${m.id} ${m.request.destination} ${m.status} ${m.createdAt}`
          .toLowerCase()
          .includes(query),
    )
    .sort(newestFirst);
}
export function inferenceLabel(provider?: string) {
  if (provider === "nvidia-direct") return "NVIDIA direct";
  if (provider === "meterless-nightshift") return "Nightshift Runtime";
  if (provider === "sample" || provider?.startsWith("deterministic sample"))
    return "Sample rules; no hosted inference";
  return provider || "Not observed";
}
export function receiptMap(
  mode: string | undefined,
  fixtures: Fixtures | undefined,
  receipt: Receipt | undefined,
  now: number,
): { fixtures?: Fixtures; caption: string } {
  if (!mode || !fixtures)
    return { caption: "Connect to Relay to resolve the map source." };
  if (mode === "offline_sample")
    return {
      fixtures,
      caption: "Synthetic campus facts; illustrative layout and travel times.",
    };
  if (receipt?.mode !== "live_sponsors")
    return {
      caption:
        "Create or open a live receipt to view observed route facts. Sample map facts are hidden.",
    };
  const observations = receipt.evidence.filter((e) => e.kind === "route_edge");
  if (
    !observations.length ||
    observations.some(
      (e) =>
        e.mode !== "live_sponsors" ||
        !e.observedAt ||
        !Number.isFinite(Date.parse(e.observedAt)) ||
        now - Date.parse(e.observedAt) > 60000 ||
        Date.parse(e.observedAt) - now > 5000,
    )
  )
    return {
      caption:
        "Route observations are missing or older than 60 seconds. Refresh the plan for current route facts.",
    };
  const edges: Fixtures["edges"] = [];
  for (const observation of observations) {
    const f = observation.facts;
    if (
      !f ||
      typeof f.id !== "string" ||
      f.id !== observation.recordId ||
      typeof f.from !== "string" ||
      typeof f.to !== "string" ||
      typeof f.minutes !== "number" ||
      !Number.isFinite(f.minutes) ||
      f.minutes < 0 ||
      typeof f.closed !== "boolean"
    )
      return {
        caption: "The receipt has incomplete route facts. Refresh the plan.",
      };
    edges.push({
      id: f.id,
      from: f.from,
      to: f.to,
      minutes: f.minutes,
      closed: f.closed,
    });
  }
  const ids = new Set(edges.flatMap((e) => [e.from, e.to]));
  const nodes = fixtures.nodes
    .filter((n) => ids.has(n.id))
    .map((n) => ({
      ...n,
      name:
        receipt.candidates.find((c) => c.supplier.pickupNode === n.id)?.supplier
          .name ?? n.name,
    }));
  if (nodes.length !== ids.size)
    return {
      caption:
        "Observed route nodes have no schematic positions. Use the receipt's route IDs and source facts below.",
    };
  return {
    fixtures: { revision: 0, edges, nodes, suppliers: [], couriers: [] },
    caption: `Route facts observed ${new Date(Math.min(...observations.map((e) => Date.parse(e.observedAt!)))).toLocaleTimeString()}; illustrative node positions.`,
  };
}
