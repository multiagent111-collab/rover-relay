import { test } from "node:test";
import assert from "node:assert/strict";
import { ZetarisData } from "../src/adapters/data.ts";
import { sampleEvidence } from "../src/evidence.ts";
import { seedFixtures } from "../src/fixtures.ts";
import { enumerateCandidates } from "../src/domain.ts";
import { reason, type Generator } from "../src/agents.ts";
import { evidenceSchema } from "../src/types.ts";
import { proposalFor } from "../src/review.ts";

const identity = { tenant: "relay-demo", user: "coordinator" };
const request = {
  sku: "HDMI-USB-C" as const,
  quantity: 2,
  destination: "auditorium" as const,
  budgetCents: 3500,
  deadlineMinutes: 30,
};
const memory = {
  records: [],
  context: "",
  entrance: null,
  revision: "",
  engine: "controlled test",
};
function sourceRows() {
  const fixtures = seedFixtures();
  const observedAt = new Date(Date.now() - 10000).toISOString();
  const candidates = fixtures.couriers.map((c) => {
    const s = fixtures.suppliers.find((s) => s.id === c.supplierId)!;
    return {
      tenant_id: "relay-demo",
      supplier_id: s.id,
      supplier_name: s.name,
      sku: s.sku,
      stock: s.stock,
      unit_price_cents: s.unitPriceCents,
      pickup_node: s.pickupNode,
      handling_minutes: s.handlingMinutes,
      supplier_version: s.version,
      courier_id: c.id,
      courier_name: c.name,
      courier_node: c.node,
      delivery_cents: c.deliveryCents,
      available: c.available,
      courier_version: c.version,
      capacity: c.capacity,
      supplier_source: "independent_supplier_http",
      courier_source: "courier_postgres",
      supplier_observed_at: observedAt,
      courier_observed_at: observedAt,
    };
  });
  const edges = fixtures.edges.map((e) => ({
    tenant_id: "relay-demo",
    id: e.id,
    from_node: e.from,
    to_node: e.to,
    minutes: e.minutes,
    closed: e.closed,
    version: 1,
    observed_at: observedAt,
  }));
  return { candidates, edges };
}
async function mocked<T>(
  action: (rows: ReturnType<typeof sourceRows>) => Promise<T>,
  response?: (sql: string, rows: ReturnType<typeof sourceRows>) => unknown,
) {
  const names = [
    "ZETARIS_REST_URL",
    "ZETARIS_API_KEY",
    "ZETARIS_ORG_ID",
    "ZETARIS_CANDIDATE_VIEW",
    "ZETARIS_ROUTE_VIEW",
  ];
  const old = names.map((name) => process.env[name]);
  Object.assign(process.env, {
    ZETARIS_REST_URL: "http://zetaris.invalid/api/v1.0",
    ZETARIS_API_KEY: "controlled-placeholder",
    ZETARIS_ORG_ID: "1",
    ZETARIS_CANDIDATE_VIEW: "relay_candidates",
    ZETARIS_ROUTE_VIEW: "relay_route_edges",
  });
  const original = globalThis.fetch;
  const rows = sourceRows();
  globalThis.fetch = async (_url, options) => {
    const sql = JSON.parse(String(options?.body)).sql as string;
    assert.match(sql, /^SELECT .+ WHERE tenant_id = 'relay-demo' LIMIT 100$/);
    assert.ok(!/;|\b(?:UPDATE|INSERT|DELETE|DROP)\b/i.test(sql));
    return Response.json(
      response
        ? response(sql, rows)
        : {
            data: sql.includes("relay_route_edges")
              ? rows.edges
              : rows.candidates,
          },
    );
  };
  try {
    return await action(rows);
  } finally {
    globalThis.fetch = original;
    names.forEach((name, i) =>
      old[i] === undefined
        ? delete process.env[name]
        : (process.env[name] = old[i]),
    );
  }
}

test("candidate citations cover only its supplier, courier and used edges; duplicate rows deduplicate and hashes survive another query", async () =>
  mocked(async (rows) => {
    rows.candidates.push({ ...rows.candidates[0] });
    rows.edges.push({ ...rows.edges[0] });
    const first = await new ZetarisData().snapshot(identity);
    const second = await new ZetarisData().snapshot(identity);
    assert.equal(first.evidence.length, 18);
    assert.equal(new Set(first.evidence.map((item) => item.id)).size, 18);
    assert.deepEqual(
      first.evidence.map((item) => item.contentHash),
      second.evidence.map((item) => item.contentHash),
    );
    assert.notEqual(first.evidence[0].queryId, second.evidence[0].queryId);
    assert.ok(
      first.evidence.every(
        (item) =>
          item.observedAt === rows.candidates[0].supplier_observed_at &&
          evidenceSchema.safeParse(item).success,
      ),
    );
    const chosen = enumerateCandidates(
      first.fixtures,
      request,
      first.evidence,
    ).find((c) => c.id === "supplier-a:courier-1")!;
    const scoped = first.evidence.filter((e) =>
      chosen.evidenceIds.includes(e.id),
    );
    assert.ok(chosen.feasible);
    assert.deepEqual(
      scoped.filter((e) => e.kind === "supplier").map((e) => e.recordId),
      ["supplier-a"],
    );
    assert.deepEqual(
      scoped.filter((e) => e.kind === "courier").map((e) => e.recordId),
      ["courier-1"],
    );
    assert.deepEqual(
      scoped
        .filter((e) => e.kind === "route_edge")
        .map((e) => e.recordId)
        .sort(),
      [...chosen.routeEdges].sort(),
    );
    assert.ok(chosen.evidenceIds.length < first.evidence.length);
  }));

test("every required selected-candidate citation is enforced even when a controlled Critic approves; unrelated citations are unnecessary", async () => {
  const fixtures = seedFixtures();
  const evidence = sampleEvidence(fixtures, new Date().toISOString());
  const candidates = enumerateCandidates(fixtures, request, evidence);
  const chosen = candidates.find((c) => c.feasible)!;
  const run = (ids: string[]) => {
    const generator: Generator = {
      generate: async (role) => ({
        provider: "controlled",
        model: "controlled",
        value:
          role === "Planner"
            ? {
                ...proposalFor(request, memory, candidates, chosen),
                evidenceIds: ids,
              }
            : { approved: true, issues: [], refreshEvidence: false },
      }),
    };
    return reason(
      generator,
      { request, candidates, memory },
      async () => candidates,
    );
  };
  assert.equal((await run(chosen.evidenceIds)).proposal.candidateId, chosen.id);
  for (const id of chosen.evidenceIds)
    await assert.rejects(
      run(chosen.evidenceIds.filter((item) => item !== id)),
      { code: "reasoning_exhausted" },
    );
  await assert.rejects(run([...chosen.evidenceIds, "invented-evidence"]), {
    code: "reasoning_exhausted",
  });
  await assert.rejects(run([...chosen.evidenceIds, chosen.evidenceIds[0]]), {
    code: "reasoning_exhausted",
  });
});

test("missing or tampered observations fail candidate checks; blocked paths require complete graph evidence", () => {
  const fixtures = seedFixtures();
  const evidence = sampleEvidence(fixtures, new Date().toISOString());
  for (const kind of ["supplier", "courier", "route_edge"]) {
    const missing = evidence.filter((e) => e.kind !== kind);
    assert.ok(
      enumerateCandidates(fixtures, request, missing).every((c) => !c.feasible),
    );
  }
  const changed = structuredClone(evidence);
  changed.find(
    (e) => e.kind === "supplier" && e.recordId === "supplier-a",
  )!.facts!.stock = 999;
  assert.equal(
    enumerateCandidates(fixtures, request, changed).find(
      (c) => c.id === "supplier-a:courier-1",
    )!.feasible,
    false,
  );
  fixtures.edges
    .filter((e) => e.from === "hub")
    .forEach((e) => (e.closed = true));
  const blocked = enumerateCandidates(
    fixtures,
    request,
    sampleEvidence(fixtures, new Date().toISOString()),
  )[0];
  assert.equal(blocked.checks.find((c) => c.code === "route")!.passed, false);
  assert.equal(blocked.evidenceIds.length, fixtures.edges.length + 2);
});

const cases: {
  name: string;
  mutate: (rows: ReturnType<typeof sourceRows>) => void;
  code: string;
}[] = [
  {
    name: "empty candidate set",
    mutate: (r) => {
      r.candidates = [];
    },
    code: "incomplete_source",
  },
  {
    name: "empty graph",
    mutate: (r) => {
      r.edges = [];
    },
    code: "incomplete_source",
  },
  {
    name: "missing graph edge",
    mutate: (r) => {
      r.edges.pop();
    },
    code: "incomplete_source",
  },
  {
    name: "cross-tenant candidate",
    mutate: (r) => {
      r.candidates[0].tenant_id = "another-tenant";
    },
    code: "tenant_denied",
  },
  {
    name: "cross-tenant edge",
    mutate: (r) => {
      r.edges[0].tenant_id = "another-tenant";
    },
    code: "tenant_denied",
  },
  {
    name: "conflicting supplier facts",
    mutate: (r) => {
      r.candidates.push({ ...r.candidates[0], stock: 88 });
    },
    code: "conflicting_source",
  },
  {
    name: "conflicting courier corridor",
    mutate: (r) => {
      r.candidates[1].courier_id = r.candidates[0].courier_id;
    },
    code: "conflicting_source",
  },
  {
    name: "conflicting edge facts",
    mutate: (r) => {
      r.edges.push({ ...r.edges[0], minutes: 99 });
    },
    code: "conflicting_source",
  },
  {
    name: "unknown graph node",
    mutate: (r) => {
      r.edges[0].from_node = "private-unknown-node";
    },
    code: "zetaris_contract",
  },
  {
    name: "stale edge",
    mutate: (r) => {
      r.edges[0].observed_at = "2000-01-01T00:00:00Z";
    },
    code: "stale_source",
  },
  {
    name: "future supplier clock",
    mutate: (r) => {
      r.candidates[0].supplier_observed_at = "2099-01-01T00:00:00Z";
    },
    code: "stale_source",
  },
  {
    name: "null stock",
    mutate: (r) => {
      (r.candidates[0] as unknown as { stock: null }).stock = null;
    },
    code: "zetaris_contract",
  },
  {
    name: "blank price",
    mutate: (r) => {
      (
        r.candidates[0] as unknown as { unit_price_cents: string }
      ).unit_price_cents = "";
    },
    code: "zetaris_contract",
  },
  {
    name: "same source aliases",
    mutate: (r) => {
      r.candidates[0].supplier_source = r.candidates[0].courier_source;
    },
    code: "federation_unproven",
  },
];
for (const item of cases)
  test(`source validation refuses ${item.name}`, async () =>
    mocked(async (rows) => {
      item.mutate(rows);
      await assert.rejects(new ZetarisData().snapshot(identity), {
        code: item.code,
      });
    }));

test("explicit partial/truncated responses and invalid positional rows fail closed", async () => {
  for (const metadata of [
    { hasMore: true },
    { truncated: true },
    { totalCount: 99 },
    { error: "sensitive raw upstream body" },
  ])
    await mocked(
      async () => {
        await assert.rejects(new ZetarisData().snapshot(identity), (error) => {
          assert.ok(
            ["zetaris_truncated", "zetaris_contract"].includes(
              (error as { code: string }).code,
            ),
          );
          assert.ok(!String(error).includes("sensitive raw upstream body"));
          return true;
        });
      },
      (_sql, r) => ({ data: r.candidates, ...metadata }),
    );
  await mocked(
    async () => {
      await assert.rejects(new ZetarisData().snapshot(identity), {
        code: "zetaris_contract",
      });
    },
    () => ({ data: [["relay-demo"]] }),
  );
});

test("positional SQL rows preserve tenant/projection order and normalize typed numeric strings", async () =>
  mocked(
    async () => {
      const result = await new ZetarisData().snapshot(identity);
      assert.equal(result.fixtures.suppliers[0].unitPriceCents, 1200);
      assert.ok(result.evidence.every((e) => e.kind && e.contentHash));
    },
    (sql, rows) => {
      const columns = sql.slice(7, sql.indexOf(" FROM ")).split(", ");
      const data = sql.includes("relay_route_edges")
        ? rows.edges
        : rows.candidates;
      return {
        data: data.map((row) =>
          columns.map((key) => {
            const value = (row as unknown as Record<string, unknown>)[key];
            return typeof value === "number" ? String(value) : value;
          }),
        ),
      };
    },
  ));

test("unsafe identifiers, external tenants and arbitrary SQL never reach the transport", async () =>
  mocked(async () => {
    globalThis.fetch = async () => {
      assert.fail("Unsafe request reached the network");
    };
    await assert.rejects(
      new ZetarisData().snapshot({ tenant: "other", user: "coordinator" }),
      { code: "tenant_denied" },
    );
    for (const name of ["a..b", "a.", "table;DELETE", "a b", ".private"]) {
      process.env.ZETARIS_CANDIDATE_VIEW = name;
      await assert.rejects(new ZetarisData().snapshot(identity), {
        code: "invalid_configuration",
      });
    }
    await assert.rejects(new ZetarisData().query("DELETE FROM relay_state"), {
      code: "query_denied",
    });
  }));
