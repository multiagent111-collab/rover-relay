import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NightshiftGenerator } from "../src/agents.ts";
import { ZetarisData, boundedJson } from "../src/adapters/data.ts";
import { enumerateCandidates } from "../src/domain.ts";
import { seedFixtures } from "../src/fixtures.ts";
import { sampleEvidence } from "../src/evidence.ts";
import { configuration } from "../src/config.ts";
import { createApp } from "../src/app.ts";
import { proposalFor } from "../src/review.ts";

function environment(values: Record<string, string>) {
  const before = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  return () => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
const identity = { tenant: "relay-demo", user: "coordinator" };
const request = {
  sku: "HDMI-USB-C" as const,
  quantity: 2,
  destination: "auditorium" as const,
  budgetCents: 3500,
  deadlineMinutes: 30,
};
const agentInput = {
  request,
  candidates: enumerateCandidates(
    seedFixtures(),
    request,
    sampleEvidence(seedFixtures(), new Date().toISOString()),
  ),
  memory: {
    records: [],
    context: "",
    entrance: null,
    revision: "",
    engine: "test",
  },
  round: 1,
  feedback: [],
};

test("Nightshift adapter sends the real provider contract and preserves reported model identity", async () => {
  const restore = environment({
    METERLESS_BASE_URL: "http://runtime.invalid:8088/v1/chat/completions",
    METERLESS_RUNTIME_TOKEN: "test-placeholder-token",
    METERLESS_ROUTE: "meterless/fast",
  });
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(
        String(url),
        "http://runtime.invalid:8088/v1/chat/completions",
      );
      const headers = new Headers(options?.headers);
      assert.equal(
        headers.get("Authorization"),
        "Bearer test-placeholder-token",
      );
      assert.equal(headers.get("meterless-app"), "rover-relay");
      assert.equal(headers.get("meterless-scope"), "user");
      const payload = JSON.parse(options?.body as string);
      assert.equal(payload.model, "meterless/fast");
      assert.deepEqual(payload.response_format, { type: "json_object" });
      assert.match(payload.messages[0].content, /proposal-2\.0/);
      assert.equal(payload.tools, undefined);
      return Response.json({
        id: "runtime-request-1",
        model: "reported-model",
        choices: [
          {
            message: {
              content: JSON.stringify(
                proposalFor(
                  agentInput.request,
                  agentInput.memory,
                  agentInput.candidates,
                ),
              ),
            },
          },
        ],
      });
    };
    const result = await new NightshiftGenerator().generate(
      "Planner",
      agentInput,
      AbortSignal.timeout(1000),
    );
    assert.equal(result.requestId, "runtime-request-1");
    assert.equal(result.model, "reported-model");
  } finally {
    globalThis.fetch = original;
    restore();
  }
});

test("Nightshift unauthorized and malformed output remain distinct controlled failures", async () => {
  const restore = environment({
    METERLESS_BASE_URL: "http://runtime.invalid",
    METERLESS_RUNTIME_TOKEN: "test-placeholder",
    METERLESS_ROUTE: "meterless/fast",
  });
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("", { status: 401 });
    await assert.rejects(
      new NightshiftGenerator().generate(
        "Planner",
        agentInput,
        AbortSignal.timeout(1000),
      ),
      { code: "nightshift_unauthorized" },
    );
    globalThis.fetch = async () =>
      Response.json({ choices: [{ message: { content: "not JSON" } }] });
    await assert.rejects(
      new NightshiftGenerator().generate(
        "Critic",
        agentInput,
        AbortSignal.timeout(1000),
      ),
      { code: "invalid_model_output" },
    );
  } finally {
    globalThis.fetch = original;
    restore();
  }
});

test("an output-limit response cannot become an accepted proposal even when its prefix is valid JSON", async () => {
  const restore = environment({
    METERLESS_BASE_URL: "http://runtime.invalid",
    METERLESS_RUNTIME_TOKEN: "test-placeholder",
    METERLESS_ROUTE: "meterless/fast",
  });
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json({
        choices: [
          {
            finish_reason: "length",
            message: {
              content: JSON.stringify(
                proposalFor(
                  agentInput.request,
                  agentInput.memory,
                  agentInput.candidates,
                ),
              ),
            },
          },
        ],
      });
    await assert.rejects(
      new NightshiftGenerator().generate(
        "Planner",
        agentInput,
        AbortSignal.timeout(1000),
      ),
      { code: "invalid_model_output" },
    );
  } finally {
    globalThis.fetch = original;
    restore();
  }
});

function candidateRows(observedAt = new Date().toISOString()) {
  return [
    {
      tenant_id: "relay-demo",
      supplier_id: "supplier-a",
      supplier_name: "Campus Tech",
      sku: "HDMI-USB-C",
      stock: "6",
      unit_price_cents: "1.2e3",
      pickup_node: "supplier-a",
      handling_minutes: "2",
      supplier_version: "1",
      courier_id: "courier-1",
      courier_name: "Alex",
      courier_node: "hub",
      delivery_cents: "800",
      available: "true",
      courier_version: "1",
      capacity: "10",
      supplier_source: "independent_supplier",
      courier_source: "courier_postgres",
      supplier_observed_at: observedAt,
      courier_observed_at: observedAt,
    },
  ];
}
test("malformed model identity is rejected without inventing or echoing metadata", async () => {
  const restore = environment({
    METERLESS_BASE_URL: "http://runtime.invalid",
    METERLESS_RUNTIME_TOKEN: "test-placeholder",
    METERLESS_ROUTE: "meterless/fast",
  });
  const original = globalThis.fetch;
  try {
    for (const identity of [
      { model: { private: "invalid" } },
      { model: "x".repeat(201) },
      { id: "bad\nrequest" },
    ]) {
      globalThis.fetch = async () =>
        Response.json({
          ...identity,
          choices: [{ message: { content: "{}" } }],
        });
      await assert.rejects(
        new NightshiftGenerator().generate(
          "Planner",
          agentInput,
          AbortSignal.timeout(1000),
        ),
        { code: "invalid_model_output" },
      );
    }
  } finally {
    globalThis.fetch = original;
    restore();
  }
});

test("Zetaris adapter uses fixed queries, numeric conversion, source versions, and fresh evidence", async () => {
  const restore = environment({
    ZETARIS_REST_URL: "http://zetaris.invalid/api/v1.0",
    ZETARIS_API_KEY: "test-placeholder",
    ZETARIS_ORG_ID: "1",
  });
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(
        String(url),
        "http://zetaris.invalid/api/v1.0/sql-editor/sqls/run",
      );
      const headers = new Headers(options?.headers);
      assert.equal(headers.get("X-Org-ID"), "1");
      assert.match(headers.get("X-Request-ID")!, /^[a-f0-9-]{36}$/);
      const payload = JSON.parse(options?.body as string);
      assert.match(payload.sql, /WHERE tenant_id = 'relay-demo' LIMIT 100$/);
      assert.equal(payload.limit, 100);
      return Response.json({
        data: payload.sql.includes("relay_route_edges")
          ? seedFixtures().edges.map((edge) => ({
              tenant_id: "relay-demo",
              id: edge.id,
              from_node: edge.from,
              to_node: edge.to,
              minutes: edge.minutes,
              closed: edge.closed,
              version: "1",
              observed_at: new Date().toISOString(),
            }))
          : candidateRows(),
      });
    };
    const snapshot = await new ZetarisData().snapshot(identity);
    assert.equal(calls, 2);
    assert.equal(snapshot.fixtures.suppliers[0].unitPriceCents, 1200);
    assert.equal(snapshot.fixtures.couriers[0].available, true);
    assert.ok(snapshot.evidence.every((evidence) => evidence.queryId));
  } finally {
    globalThis.fetch = original;
    restore();
  }
});

test("Zetaris stale observations and unsafe configured identifiers fail closed", async () => {
  const restore = environment({
    ZETARIS_REST_URL: "http://zetaris.invalid/api/v1.0",
    ZETARIS_API_KEY: "test-placeholder",
    ZETARIS_ORG_ID: "1",
    ZETARIS_CANDIDATE_VIEW: "relay_candidates",
  });
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) =>
      Response.json({
        data: JSON.parse(options?.body as string).sql.includes(
          "relay_route_edges",
        )
          ? []
          : candidateRows("2000-01-01T00:00:00Z"),
      });
    await assert.rejects(new ZetarisData().snapshot(identity), {
      code: "stale_source",
    });
    process.env.ZETARIS_CANDIDATE_VIEW = "table; DROP TABLE jobs";
    await assert.rejects(new ZetarisData().snapshot(identity), {
      code: "invalid_configuration",
    });
    await assert.rejects(
      new ZetarisData().snapshot({ tenant: "other", user: "coordinator" }),
      { code: "tenant_denied" },
    );
  } finally {
    globalThis.fetch = original;
    restore();
  }
});

test("upstream response parser enforces a byte limit", async () => {
  await assert.rejects(boundedJson(new Response("x".repeat(101)), 100), {
    code: "response_too_large",
  });
});

test("live API requires its own token and does not silently enter sample mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-live-test-"));
  const restore = environment({
    METERLESS_BASE_URL: "",
    METERLESS_RUNTIME_TOKEN: "",
    METERLESS_ROUTE: "",
    ZETARIS_REST_URL: "",
    ZETARIS_API_KEY: "",
    ZETARIS_ORG_ID: "",
  });
  const { app } = await createApp({
    config: {
      ...configuration(),
      dataDir: directory,
      databaseUrl: "",
      sample: false,
      demo: false,
      accessToken: "test-access-token-at-least-24-characters",
    },
  });
  try {
    assert.equal((await app.inject({ url: "/v1/bootstrap" })).statusCode, 401);
    const headers = {
      authorization: "Bearer test-access-token-at-least-24-characters",
    };
    assert.equal(
      (await app.inject({ url: "/v1/bootstrap", headers })).json().mode,
      "live_sponsors",
    );
    const response = await app.inject({
      method: "POST",
      url: "/v1/missions",
      headers,
      payload: request,
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, "missing_configuration");
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/demo/disruptions",
          headers,
          payload: { type: "stock", supplierId: "supplier-a", stock: 0 },
        })
      ).statusCode,
      404,
    );
  } finally {
    await app.close();
    restore();
    await rm(directory, { recursive: true, force: true });
  }
});
