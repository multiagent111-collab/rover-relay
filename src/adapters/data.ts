import { randomUUID } from "node:crypto";
import { z } from "zod";
import { hash } from "../domain.ts";
import { seedFixtures } from "../fixtures.ts";
import { requireEnvironment } from "../config.ts";
import {
  RelayError,
  type DataPort,
  type Identity,
  type Snapshot,
  type Store,
} from "../types.ts";

export class SampleData implements DataPort {
  constructor(
    private store: Store,
    private clock = Date.now,
  ) {}
  async snapshot(): Promise<Snapshot> {
    const { fixtures } = await this.store.read();
    const fetchedAt = new Date(this.clock()).toISOString();
    return {
      fixtures,
      fetchedAt,
      fingerprint: hash(fixtures),
      evidence: [
        ...fixtures.suppliers.map((supplier) => ({
          id: `stock-${supplier.id}-v${supplier.version}`,
          source: "sample:supplier-fixture",
          recordId: supplier.id,
          sourceVersion: String(supplier.version),
          fetchedAt,
          mode: "offline_sample" as const,
        })),
        ...fixtures.couriers.map((courier) => ({
          id: `courier-${courier.id}-v${courier.version}`,
          source: "sample:minirover",
          recordId: courier.id,
          sourceVersion: String(courier.version),
          fetchedAt,
          mode: "offline_sample" as const,
        })),
        {
          id: `route-v${fixtures.revision}`,
          source: "sample:route-graph",
          recordId: "campus",
          sourceVersion: String(fixtures.revision),
          fetchedAt,
          mode: "offline_sample",
        },
      ],
    };
  }
}

export async function boundedJson(
  response: Response,
  maxBytes = 1024 * 1024,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader)
    throw new RelayError(503, "invalid_response", "Empty upstream response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes)
        throw new RelayError(
          503,
          "response_too_large",
          "Upstream response exceeded the limit.",
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RelayError(
      503,
      "invalid_response",
      "Upstream returned invalid JSON.",
    );
  }
}

const text = z.string().min(1).max(200);
const integer = z.coerce.number().int().min(0).max(1000000);
const flag = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((value) => value === true || value === "true");
const timestamp = z.string().datetime({ offset: true });
const candidateRow = z.object({
  supplier_id: text,
  supplier_name: text,
  sku: text,
  stock: integer,
  unit_price_cents: integer,
  pickup_node: text,
  handling_minutes: integer,
  supplier_version: integer,
  courier_id: text,
  courier_name: text,
  courier_node: text,
  delivery_cents: integer,
  available: flag,
  courier_version: integer,
  capacity: integer,
  supplier_source: text,
  courier_source: text,
  supplier_observed_at: timestamp,
  courier_observed_at: timestamp,
});
const edgeRow = z.object({
  id: text,
  from_node: text,
  to_node: text,
  minutes: integer.refine((value) => value > 0),
  closed: flag,
  version: integer,
  observed_at: timestamp,
});
const columns = [
  "supplier_id",
  "supplier_name",
  "sku",
  "stock",
  "unit_price_cents",
  "pickup_node",
  "handling_minutes",
  "supplier_version",
  "courier_id",
  "courier_name",
  "courier_node",
  "delivery_cents",
  "available",
  "courier_version",
  "capacity",
  "supplier_source",
  "courier_source",
  "supplier_observed_at",
  "courier_observed_at",
];
const edgeColumns = [
  "id",
  "from_node",
  "to_node",
  "minutes",
  "closed",
  "version",
  "observed_at",
];
const safeView = (name: string) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_.]{0,150}$/.test(name))
    throw new RelayError(
      503,
      "invalid_configuration",
      "Zetaris view name must be a qualified identifier.",
    );
  return name;
};

export class ZetarisData implements DataPort {
  async query(sql: string, signal?: AbortSignal) {
    requireEnvironment([
      "ZETARIS_REST_URL",
      "ZETARIS_API_KEY",
      "ZETARIS_ORG_ID",
    ]);
    if (!/^\d+$/.test(process.env.ZETARIS_ORG_ID!))
      throw new RelayError(
        503,
        "invalid_configuration",
        "Zetaris organization ID must be numeric.",
      );
    const queryId = randomUUID();
    let response: Response;
    try {
      response = await fetch(
        `${process.env.ZETARIS_REST_URL!.replace(/\/$/, "")}/sql-editor/sqls/run`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.ZETARIS_API_KEY}`,
            "X-Org-ID": process.env.ZETARIS_ORG_ID!,
            "X-Request-ID": queryId,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            queryId,
            sql,
            source: "SqlEditor",
            limit: 100,
          }),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
            : AbortSignal.timeout(20000),
        },
      );
    } catch {
      throw new RelayError(
        503,
        "zetaris_unavailable",
        "Zetaris request failed or timed out.",
      );
    }
    if (!response.ok)
      throw new RelayError(
        503,
        response.status === 401 || response.status === 403
          ? "zetaris_unauthorized"
          : "zetaris_unavailable",
        `Zetaris returned HTTP ${response.status}.`,
      );
    const payload = (await boundedJson(response)) as { data?: unknown[] };
    if (!Array.isArray(payload.data))
      throw new RelayError(
        503,
        "zetaris_contract",
        "Expected Zetaris data rows; verify this instance OpenAPI contract.",
      );
    if (payload.data.length >= 100)
      throw new RelayError(
        503,
        "zetaris_truncated",
        "Candidate query hit its row limit; narrow the view before planning.",
      );
    return { rows: payload.data, queryId };
  }
  async snapshot(identity: Identity, signal?: AbortSignal): Promise<Snapshot> {
    // One disclosed live demo tenant. The access token maps to this tenant;
    // callers cannot inject arbitrary SQL predicates.
    if (identity.tenant !== "relay-demo")
      throw new RelayError(
        403,
        "tenant_denied",
        "This live adapter supports the relay-demo tenant only.",
      );
    const view = safeView(
      process.env.ZETARIS_CANDIDATE_VIEW || "relay_candidates",
    );
    const routeView = safeView(
      process.env.ZETARIS_ROUTE_VIEW || "relay_route_edges",
    );
    const result = await this.query(
      `SELECT ${columns.join(", ")} FROM ${view} WHERE tenant_id = 'relay-demo' LIMIT 100`,
      signal,
    );
    const routes = await this.query(
      `SELECT ${edgeColumns.join(", ")} FROM ${routeView} WHERE tenant_id = 'relay-demo' LIMIT 100`,
      signal,
    );
    const records = result.rows.map((row) =>
      candidateRow.parse(
        Array.isArray(row)
          ? Object.fromEntries(columns.map((name, index) => [name, row[index]]))
          : row,
      ),
    );
    const edges = routes.rows.map((row) =>
      edgeRow.parse(
        Array.isArray(row)
          ? Object.fromEntries(
              edgeColumns.map((name, index) => [name, row[index]]),
            )
          : row,
      ),
    );
    const now = Date.now();
    const observations = [
      ...records.flatMap((row) => [
        row.supplier_observed_at,
        row.courier_observed_at,
      ]),
      ...edges.map((edge) => edge.observed_at),
    ];
    if (
      observations.some(
        (time) =>
          now - Date.parse(time) > 60000 || Date.parse(time) - now > 5000,
      )
    )
      throw new RelayError(
        503,
        "stale_source",
        "A source observation is stale or clock-skewed. Refresh the Zetaris source views.",
      );
    if (records.some((row) => row.supplier_source === row.courier_source))
      throw new RelayError(
        503,
        "federation_unproven",
        "Supplier and courier source aliases must identify independent sources.",
      );
    const fixtures = seedFixtures();
    fixtures.suppliers = [
      ...new Map(
        records.map((row) => [
          row.supplier_id,
          {
            id: row.supplier_id,
            name: row.supplier_name,
            sku: row.sku,
            stock: row.stock,
            unitPriceCents: row.unit_price_cents,
            pickupNode: row.pickup_node,
            handlingMinutes: row.handling_minutes,
            version: row.supplier_version,
          },
        ]),
      ).values(),
    ];
    fixtures.couriers = [
      ...new Map(
        records.map((row) => [
          row.courier_id,
          {
            id: row.courier_id,
            name: row.courier_name,
            node: row.courier_node,
            deliveryCents: row.delivery_cents,
            available: row.available,
            version: row.courier_version,
            capacity: row.capacity,
            supplierId: row.supplier_id,
          },
        ]),
      ).values(),
    ];
    fixtures.edges = edges.map((edge) => ({
      id: edge.id,
      from: edge.from_node,
      to: edge.to_node,
      minutes: edge.minutes,
      closed: edge.closed,
    }));
    fixtures.revision = Math.max(1, ...edges.map((edge) => edge.version));
    fixtures.suppliers.sort((a, b) => a.id.localeCompare(b.id));
    fixtures.couriers.sort((a, b) => a.id.localeCompare(b.id));
    fixtures.edges.sort((a, b) => a.id.localeCompare(b.id));
    const fetchedAt = new Date().toISOString();
    const evidence = records.flatMap((row) => [
      {
        id: `${result.queryId}:${row.supplier_id}`,
        source: row.supplier_source,
        recordId: row.supplier_id,
        sourceVersion: String(row.supplier_version),
        fetchedAt,
        observedAt: row.supplier_observed_at,
        mode: "live_sponsors" as const,
        queryId: result.queryId,
      },
      {
        id: `${result.queryId}:${row.courier_id}`,
        source: row.courier_source,
        recordId: row.courier_id,
        sourceVersion: String(row.courier_version),
        fetchedAt,
        observedAt: row.courier_observed_at,
        mode: "live_sponsors" as const,
        queryId: result.queryId,
      },
    ]);
    evidence.push({
      id: routes.queryId,
      source: routeView,
      recordId: "campus",
      sourceVersion: String(fixtures.revision),
      fetchedAt,
      observedAt: edges[0]?.observed_at || fetchedAt,
      mode: "live_sponsors",
      queryId: routes.queryId,
    });
    return { fixtures, evidence, fetchedAt, fingerprint: hash(fixtures) };
  }
}
