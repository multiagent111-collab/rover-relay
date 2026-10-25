import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NightshiftGenerator } from "../src/agents.ts";
import { runtimeRoute, nemotronRoute } from "../src/runtime-proof.ts";
import { runPreflight } from "../src/preflight.ts";
import { proposalFor } from "../src/review.ts";
import { seedFixtures } from "../src/fixtures.ts";
import { enumerateCandidates } from "../src/domain.ts";
import { sampleEvidence } from "../src/evidence.ts";
const model = "nvidia/nemotron-3-ultra-550b-a55b",
  requested = "meterless/auto",
  responseId = "chatcmpl-controlled";
function metadata(selected = model, id = responseId) {
  return {
    schema: "meterless.compute_receipt.v1",
    receipt_id: "rcpt_req_controlled",
    requested_model: requested,
    routed_model: selected,
    winning_route: { model: selected, provider: "nvidia" },
    from_cache: false,
    receipt: {
      receipt_id: "rcpt_req_controlled",
      request_id: id,
      app: "rover-relay",
      winning_route: { model: selected, provider: "nvidia" },
      app_policy: {
        requested_mode: "fast",
        routed_mode: "auto",
        bound_mode: "auto",
        race_width: 6,
      },
      usage: { latency_ms: 123 },
      prompt_preview: "PRIVATE PREVIEW",
      reasoning_scaffold: "PRIVATE REASONING",
      arbitrary_secret: "PRIVATE KEY",
    },
    receipt_envelope: {
      body: { private: "not persisted" },
      sig_b64: "not a verified signature",
    },
  };
}
function environment() {
  const values = {
    RELAY_INFERENCE_PROVIDER: "nightshift",
    METERLESS_BASE_URL: "http://runtime.invalid:8088/v1",
    METERLESS_RUNTIME_TOKEN: "test-runtime-placeholder",
    METERLESS_ROUTE: requested,
    NEMOTRON_MODEL: "nvidia/nemotron-3.5-lightning-30b-a3b",
  };
  const before = Object.fromEntries(
    Object.keys(values).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, values);
  return () => {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}
test("Runtime projection correlates receipt/request/model/provider and preserves requested versus effective routing without private content", () => {
  const projected = runtimeRoute(metadata(), responseId, model, requested)!;
  assert.equal(projected.source, "runtime_reported");
  assert.equal(projected.receiptId, "rcpt_req_controlled");
  assert.equal(projected.requestedMode, "fast");
  assert.equal(projected.effectiveMode, "auto");
  assert.equal(projected.raceWidth, 6);
  assert.equal(projected.runtimeLatencyMs, 123);
  assert.equal(projected.fromCache, false);
  assert.ok(nemotronRoute(projected));
  assert.ok(!JSON.stringify(projected).includes("PRIVATE"));
  assert.ok(!JSON.stringify(projected).includes("sig_b64"));
  assert.equal(
    runtimeRoute(undefined, responseId, model, requested),
    undefined,
  );
  assert.equal(nemotronRoute(undefined), false);
  assert.throws(
    () =>
      runtimeRoute(
        { ...metadata(), requires_review: true },
        responseId,
        model,
        requested,
      ),
    { code: "nightshift_review_required" },
  );
  const nonNemotron = metadata("nvidia/some-other-model");
  assert.equal(
    nemotronRoute(
      runtimeRoute(
        nonNemotron,
        responseId,
        "nvidia/some-other-model",
        requested,
      ),
    ),
    false,
  );
});
test("malformed or conflicting Runtime provenance fails closed instead of inventing an underlying identity", () => {
  const mutations = [
    (m: any) => {
      m.receipt.request_id = "other-response";
    },
    (m: any) => {
      m.receipt.receipt_id = "other-receipt";
    },
    (m: any) => {
      m.routed_model = "nvidia/other";
    },
    (m: any) => {
      m.winning_route.provider = "other";
    },
    (m: any) => {
      m.receipt.winning_route.model = "nvidia/other";
    },
    (m: any) => {
      m.requested_model = "meterless/fast";
    },
    (m: any) => {
      m.receipt.app_policy.race_width = 100000;
    },
    (m: any) => {
      m.receipt.request_id = "private\ntext";
    },
    (m: any) => {
      m.receipt.usage.latency_ms = -1;
    },
    (m: any) => {
      delete m.receipt;
    },
  ];
  for (const change of mutations) {
    const value = metadata();
    change(value);
    assert.throws(() => runtimeRoute(value, responseId, model, requested), {
      code: "nightshift_contract",
    });
  }
});
test("Nightshift adapter carries correlated Runtime identity; provider failure never falls back to a direct endpoint", async () => {
  const restore = environment(),
    original = globalThis.fetch;
  const request = {
    sku: "HDMI-USB-C" as const,
    quantity: 2,
    destination: "auditorium" as const,
    budgetCents: 3500,
    deadlineMinutes: 30,
  };
  const fixtures = seedFixtures(),
    candidates = enumerateCandidates(
      fixtures,
      request,
      sampleEvidence(fixtures, new Date().toISOString()),
    );
  const memory = {
    records: [],
    context: "",
    entrance: null,
    revision: "",
    engine: "controlled",
  };
  const input = { request, candidates, memory, round: 1, feedback: [] };
  let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(
        String(url),
        "http://runtime.invalid:8088/v1/chat/completions",
      );
      const body = JSON.parse(String(options!.body));
      assert.equal(body.model, requested);
      assert.equal(body.tools, undefined);
      return Response.json({
        id: responseId,
        model,
        choices: [
          {
            message: {
              content: JSON.stringify(
                proposalFor(
                  request,
                  memory,
                  candidates,
                  candidates.find((c) => c.feasible),
                ),
              ),
            },
          },
        ],
        meterless: metadata(),
      });
    };
    const result = await new NightshiftGenerator().generate(
      "Planner",
      input,
      AbortSignal.timeout(1000),
    );
    assert.equal(result.routing!.routedModel, model);
    assert.equal(result.requestId, result.routing!.responseId);
    globalThis.fetch = async () => {
      calls++;
      return Response.json({
        model,
        choices: [
          { finish_reason: "requires_review", message: { content: "{}" } },
        ],
      });
    };
    await assert.rejects(
      new NightshiftGenerator().generate(
        "Planner",
        input,
        AbortSignal.timeout(1000),
      ),
      { code: "nightshift_review_required" },
    );
    globalThis.fetch = async (url) => {
      calls++;
      assert.ok(String(url).startsWith("http://runtime.invalid"));
      return new Response("private upstream error", { status: 429 });
    };
    await assert.rejects(
      new NightshiftGenerator().generate(
        "Planner",
        input,
        AbortSignal.timeout(1000),
      ),
      { code: "nightshift_rate_limited" },
    );
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = original;
    restore();
  }
});
test("preflight distinguishes Runtime-correlated Nemotron routing from an unmatched configured model label", async () => {
  const restore = environment(),
    original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith("/models"))
        return Response.json({ data: [{ id: requested }] });
      const body = JSON.parse(String(options!.body)),
        input = JSON.parse(body.messages[1].content);
      const role = body.messages[0].content.includes("Relay Planner")
        ? "Planner"
        : "Critic";
      const value =
        role === "Planner"
          ? proposalFor(
              input.request,
              input.memory,
              input.candidates,
              input.candidates.find((c: any) => c.feasible),
            )
          : { approved: true, issues: [], refreshEvidence: false };
      const id = `chatcmpl-controlled-${role}`;
      return Response.json({
        id,
        model,
        choices: [{ message: { content: JSON.stringify(value) } }],
        meterless: metadata(model, id),
      });
    };
    const results = await runPreflight({ live: true, component: "inference" });
    assert.ok(
      results.some(
        (r) =>
          r.name === "Nightshift Runtime routing evidence" &&
          r.status === "PASS" &&
          r.runtimeRoutes?.length === 2,
      ),
    );
    assert.ok(
      results.some(
        (r) =>
          r.name === "Nemotron response identity" && r.status === "UNVERIFIED",
      ),
    );
    assert.ok(!JSON.stringify(results).includes("PRIVATE"));
  } finally {
    globalThis.fetch = original;
    restore();
  }
});
test("full Nightshift mission verifier requires explicit live authorization before loading private configuration or calling a service", async () => {
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "scripts/nightshift.ts"],
      { timeout: 10000 },
    ),
    (error) => {
      const e = error as Error & { code: number; stderr: string };
      assert.equal(e.code, 2);
      assert.match(e.stderr, /Uses real services/);
      return true;
    },
  );
});
