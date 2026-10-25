import { randomUUID } from "node:crypto";
import { z } from "zod";
import { hash } from "../domain.ts";
import { seedFixtures } from "../fixtures.ts";
import { requireEnvironment } from "../config.ts";
import {
  contentHash,
  edgeFacts,
  observation,
  sampleEvidence,
} from "../evidence.ts";
import {
  RelayError,
  type DataPort,
  type Identity,
  type Snapshot,
  type Store,
  type Evidence,
  type Fixtures,
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
      evidence: sampleEvidence(fixtures, fetchedAt),
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
const integer = z
  .union([z.number(), z.string().regex(/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i)])
  .transform(Number)
  .pipe(z.number().int().min(0).max(1000000));
const flag = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((value) => value === true || value === "true");
const timestamp = z.string().datetime({ offset: true });
const candidateRow = z.object({
  tenant_id: z.literal("relay-demo"),
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
  tenant_id: z.literal("relay-demo"),
  id: text,
  from_node: text,
  to_node: text,
  minutes: integer.refine((value) => value > 0),
  closed: flag,
  version: integer,
  observed_at: timestamp,
});
const columns = [
  "tenant_id",
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
  "tenant_id",
  "id",
  "from_node",
  "to_node",
  "minutes",
  "closed",
  "version",
  "observed_at",
];
const safeView = (name: string) => {
  if (
    name.length > 150 ||
    !/^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(name)
  )
    throw new RelayError(
      503,
      "invalid_configuration",
      "Zetaris view name must be a qualified identifier.",
    );
  return name;
};

export class ZetarisData implements DataPort {
  async query(sql: string, signal?: AbortSignal) {
    if (sql !== "SELECT 1 AS relay_connection_check")
      throw new RelayError(
        400,
        "query_denied",
        "Only the fixed connectivity check is available outside snapshot reads.",
      );
    return this.execute(sql, signal);
  }
  private async execute(sql: string, signal?: AbortSignal) {
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
    const payload = (await boundedJson(response)) as {
      data?: unknown[];
      hasMore?: unknown;
      truncated?: unknown;
      totalCount?: unknown;
      total_count?: unknown;
      error?: unknown;
      errors?: unknown;
      success?: unknown;
    } | null;
    if (
      !payload ||
      payload.error ||
      (Array.isArray(payload.errors) && payload.errors.length) ||
      payload.success === false ||
      !Array.isArray(payload.data)
    )
      throw new RelayError(
        503,
        "zetaris_contract",
        "Expected Zetaris data rows; verify this instance OpenAPI contract.",
      );
    if (
      payload.data.length >= 100 ||
      [payload.hasMore, payload.truncated].some(
        (value) => value === true || value === "true",
      ) ||
      [payload.totalCount, payload.total_count].some(
        (value) =>
          value !== undefined &&
          (!Number.isInteger(Number(value)) ||
            Number(value) > payload.data!.length),
      )
    )
      throw new RelayError(
        503,
        "zetaris_truncated",
        "Candidate query hit its row limit; narrow the view before planning.",
      );
    return { rows: payload.data, queryId, fetchedAt: new Date().toISOString() };
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
    const result = await this.execute(
      `SELECT ${columns.join(", ")} FROM ${view} WHERE tenant_id = 'relay-demo' LIMIT 100`,
      signal,
    );
    const routes = await this.execute(
      `SELECT ${edgeColumns.join(", ")} FROM ${routeView} WHERE tenant_id = 'relay-demo' LIMIT 100`,
      signal,
    );
    const parseRows = <T>(
      rows: unknown[],
      names: string[],
      schema: z.ZodType<T>,
    ): T[] =>
      rows.map((row) => {
        if (Array.isArray(row) && row.length !== names.length)
          throw new RelayError(
            503,
            "zetaris_contract",
            "Zetaris row has missing or extra projected columns.",
          );
        const object = Array.isArray(row)
          ? Object.fromEntries(names.map((name, index) => [name, row[index]]))
          : row;
        if (
          object &&
          typeof object === "object" &&
          "tenant_id" in object &&
          object.tenant_id !== "relay-demo"
        )
          throw new RelayError(
            403,
            "tenant_denied",
            "Zetaris returned a row outside the configured demo tenant.",
          );
        const parsed = schema.safeParse(object);
        if (!parsed.success)
          throw new RelayError(
            503,
            "zetaris_contract",
            "Zetaris rows do not match the required typed projection; raw values were hidden.",
          );
        return parsed.data;
      });
    const records = parseRows(result.rows, columns, candidateRow);
    const edges = parseRows(routes.rows, edgeColumns, edgeRow);
    const now = Date.now();
    const timestamps = [
      ...records.flatMap((row) => [
        row.supplier_observed_at,
        row.courier_observed_at,
      ]),
      ...edges.map((edge) => edge.observed_at),
    ];
    if (
      timestamps.some(
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
    if (
      !records.length ||
      !edges.length ||
      fixtures.edges.some(
        (expected) => !edges.some((edge) => edge.id === expected.id),
      )
    )
      throw new RelayError(
        503,
        "incomplete_source",
        "Candidate rows and the complete campus edge set are required; include closed edges rather than dropping them.",
      );
    const nodes = new Set(fixtures.nodes.map((node) => node.id));
    if (
      records.some(
        (row) => !nodes.has(row.pickup_node) || !nodes.has(row.courier_node),
      ) ||
      edges.some(
        (edge) =>
          !nodes.has(edge.from_node) ||
          !nodes.has(edge.to_node) ||
          edge.from_node === edge.to_node,
      )
    )
      throw new RelayError(
        503,
        "zetaris_contract",
        "Source nodes must belong to the supported campus graph.",
      );
    const suppliers = new Map<string, Fixtures["suppliers"][number]>();
    const couriers = new Map<string, Fixtures["couriers"][number]>();
    const graph = new Map<string, Fixtures["edges"][number]>();
    const observations = new Map<string, Evidence>();
    const unique = <T>(map: Map<string, T>, id: string, value: T) => {
      if (map.has(id) && contentHash(map.get(id)) !== contentHash(value))
        throw new RelayError(
          503,
          "conflicting_source",
          "Repeated source IDs have conflicting facts or observation metadata. Refresh the source snapshot.",
        );
      map.set(id, value);
    };
    const add = (item: Evidence) =>
      unique(observations, `${item.kind}:${item.recordId}`, item);
    for (const row of records) {
      const supplier = {
        id: row.supplier_id,
        name: row.supplier_name,
        sku: row.sku,
        stock: row.stock,
        unitPriceCents: row.unit_price_cents,
        pickupNode: row.pickup_node,
        handlingMinutes: row.handling_minutes,
        version: row.supplier_version,
      };
      const courier = {
        id: row.courier_id,
        name: row.courier_name,
        node: row.courier_node,
        deliveryCents: row.delivery_cents,
        available: row.available,
        version: row.courier_version,
        capacity: row.capacity,
        supplierId: row.supplier_id,
      };
      unique(suppliers, supplier.id, supplier);
      unique(couriers, courier.id, courier);
      add(
        observation(
          "supplier",
          row.supplier_source,
          supplier.id,
          String(supplier.version),
          supplier,
          result.fetchedAt,
          row.supplier_observed_at,
          "live_sponsors",
          result.queryId,
        ),
      );
      add(
        observation(
          "courier",
          row.courier_source,
          courier.id,
          String(courier.version),
          courier,
          result.fetchedAt,
          row.courier_observed_at,
          "live_sponsors",
          result.queryId,
        ),
      );
    }
    for (const row of edges) {
      const edge = {
        id: row.id,
        from: row.from_node,
        to: row.to_node,
        minutes: row.minutes,
        closed: row.closed,
        version: row.version,
      };
      unique(graph, edge.id, edge);
      add(
        observation(
          "route_edge",
          routeView,
          edge.id,
          String(edge.version),
          edgeFacts(edge),
          routes.fetchedAt,
          row.observed_at,
          "live_sponsors",
          routes.queryId,
        ),
      );
    }
    fixtures.suppliers = [...suppliers.values()];
    fixtures.couriers = [...couriers.values()];
    fixtures.edges = [...graph.values()];
    fixtures.revision = Math.max(1, ...edges.map((edge) => edge.version));
    fixtures.suppliers.sort((a, b) => a.id.localeCompare(b.id));
    fixtures.couriers.sort((a, b) => a.id.localeCompare(b.id));
    fixtures.edges.sort((a, b) => a.id.localeCompare(b.id));
    const fetchedAt = routes.fetchedAt;
    const evidence = [...observations.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    return { fixtures, evidence, fetchedAt, fingerprint: hash(fixtures) };
  }
}
