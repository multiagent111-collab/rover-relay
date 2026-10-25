import { createHash } from "node:crypto";
import type { Evidence, Fixtures } from "./types.ts";

type Facts = Record<string, string | number | boolean>;
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]),
        )
      : value;
export const contentHash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export function observation(
  kind: NonNullable<Evidence["kind"]>,
  source: string,
  recordId: string,
  sourceVersion: string,
  facts: Facts,
  fetchedAt: string,
  observedAt: string,
  mode: Evidence["mode"],
  queryId?: string,
): Evidence {
  const digest = contentHash({ kind, source, recordId, sourceVersion, facts });
  return {
    id: `obs-${kind}-${digest}`,
    kind,
    source,
    recordId,
    sourceVersion,
    facts,
    contentHash: digest,
    fetchedAt,
    observedAt,
    mode,
    ...(queryId ? { queryId } : {}),
    provenance: "application_projection",
  };
}
export const edgeFacts = (edge: Fixtures["edges"][number]): Facts => ({
  id: edge.id,
  from: edge.from,
  to: edge.to,
  minutes: edge.minutes,
  closed: edge.closed,
});
export function matchesObservation(
  item: Evidence,
  kind: Evidence["kind"],
  recordId: string,
  version: string,
  facts: Facts,
) {
  return (
    item.kind === kind &&
    item.recordId === recordId &&
    item.sourceVersion === version &&
    !!item.observedAt &&
    Number.isFinite(Date.parse(item.observedAt)) &&
    !!item.facts &&
    contentHash(item.facts) === contentHash(facts) &&
    item.contentHash ===
      contentHash({
        kind,
        source: item.source,
        recordId,
        sourceVersion: version,
        facts,
      })
  );
}
export function sampleEvidence(
  fixtures: Fixtures,
  fetchedAt: string,
): Evidence[] {
  return [
    ...fixtures.suppliers.map((s) =>
      observation(
        "supplier",
        "sample:supplier-fixture",
        s.id,
        String(s.version),
        s,
        fetchedAt,
        fetchedAt,
        "offline_sample",
      ),
    ),
    ...fixtures.couriers.map((c) =>
      observation(
        "courier",
        "sample:minirover",
        c.id,
        String(c.version),
        c,
        fetchedAt,
        fetchedAt,
        "offline_sample",
      ),
    ),
    ...fixtures.edges.map((e) =>
      observation(
        "route_edge",
        "sample:route-graph",
        e.id,
        String(e.version ?? fixtures.revision),
        edgeFacts(e),
        fetchedAt,
        fetchedAt,
        "offline_sample",
      ),
    ),
  ];
}
