import { test } from "node:test";
import assert from "node:assert/strict";
import { NvidiaGenerator, liveGenerator } from "../src/agents.ts";
import { runPreflight } from "../src/preflight.ts";
import { enumerateCandidates } from "../src/domain.ts";
import { seedFixtures } from "../src/fixtures.ts";

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
const model = "nvidia/nemotron-3.5-lightning-30b-a3b";
const request = {
  sku: "HDMI-USB-C" as const,
  quantity: 2,
  destination: "auditorium" as const,
  budgetCents: 3500,
  deadlineMinutes: 30,
};
const input = {
  request,
  candidates: enumerateCandidates(seedFixtures(), request, ["e1"]),
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

test("NVIDIA-direct uses only NVIDIA credentials and the reported model, with no Nightshift fallback", async () => {
  const restore = environment({
    RELAY_INFERENCE_PROVIDER: "nvidia",
    NVIDIA_API_KEY: "test-nvidia-secret",
    NEMOTRON_MODEL: model,
  });
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(
        String(url),
        "https://integrate.api.nvidia.com/v1/chat/completions",
      );
      const headers = new Headers(options?.headers);
      assert.equal(headers.get("Authorization"), "Bearer test-nvidia-secret");
      assert.equal(headers.get("meterless-app"), null);
      const payload = JSON.parse(options?.body as string);
      assert.equal(payload.model, model);
      assert.equal(payload.stream, false);
      return Response.json({
        id: "controlled-request",
        model,
        choices: [
          {
            message: {
              content:
                '{"candidateId":null,"evidenceIds":[],"summary":"Controlled response"}',
            },
          },
        ],
      });
    };
    const result = await liveGenerator().generate(
      "Planner",
      input,
      AbortSignal.timeout(1000),
    );
    assert.equal(result.provider, "nvidia-direct");
    assert.equal(result.model, model);
    globalThis.fetch = async () => {
      calls++;
      return new Response("secret upstream body", { status: 429 });
    };
    await assert.rejects(
      new NvidiaGenerator().generate(
        "Planner",
        input,
        AbortSignal.timeout(1000),
      ),
      { code: "nvidia_rate_limited" },
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
    restore();
  }
});

test("unknown inference provider or non-Nemotron model cannot trigger a call", async () => {
  const restore = environment({
    RELAY_INFERENCE_PROVIDER: "unknown",
    NVIDIA_API_KEY: "test-placeholder",
    NEMOTRON_MODEL: "some/other-model",
  });
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("Must not call network");
    };
    assert.throws(() => liveGenerator(), { code: "invalid_configuration" });
    await assert.rejects(
      new NvidiaGenerator().generate(
        "Planner",
        input,
        AbortSignal.timeout(1000),
      ),
      { code: "invalid_configuration" },
    );
  } finally {
    globalThis.fetch = original;
    restore();
  }
});

test("preflight checks Zetaris even when inference and Relay credentials are missing", async () => {
  const restore = environment({
    RELAY_ACCESS_TOKEN: "",
    RELAY_INFERENCE_PROVIDER: "nvidia",
    NVIDIA_API_KEY: "",
    NEMOTRON_MODEL: model,
    ZETARIS_REST_URL: "http://zetaris.invalid/api/v1.0",
    ZETARIS_API_KEY: "test-placeholder",
    ZETARIS_ORG_ID: "1",
  });
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      calls++;
      const payload = JSON.parse(options?.body as string);
      return payload.sql === "SELECT 1 AS relay_connection_check"
        ? Response.json({ data: [["1"]] })
        : new Response("private upstream details", { status: 401 });
    };
    const results = await runPreflight({ live: true });
    assert.equal(calls, 2);
    assert.ok(
      results.some((r) => r.name === "Inference" && r.status === "FAIL"),
    );
    assert.ok(
      results.some(
        (r) => r.name === "Zetaris authenticated SQL" && r.status === "PASS",
      ),
    );
    assert.ok(
      results.some(
        (r) => r.name === "Zetaris operational views" && r.status === "FAIL",
      ),
    );
    assert.ok(!JSON.stringify(results).includes("private upstream details"));
  } finally {
    globalThis.fetch = original;
    restore();
  }
});

test("Nightshift route discovery and successful inference do not attest an underlying Nemotron identity", async () => {
  const restore = environment({
    RELAY_INFERENCE_PROVIDER: "nightshift",
    METERLESS_BASE_URL: "http://runtime.invalid:8088/v1",
    METERLESS_RUNTIME_TOKEN: "test-placeholder",
    METERLESS_ROUTE: "meterless/fast",
    NEMOTRON_MODEL: model,
  });
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith("/models"))
        return Response.json({ data: [{ id: "meterless/fast" }] });
      const payload = JSON.parse(options?.body as string);
      const data = JSON.parse(payload.messages[1].content);
      const candidate = data.candidates.find(
        (c: { feasible: boolean }) => c.feasible,
      );
      const value = payload.messages[0].content.includes("Relay Planner")
        ? {
            candidateId: candidate.id,
            evidenceIds: candidate.evidenceIds,
            summary: "Controlled valid plan",
          }
        : { approved: true, issues: [], refreshEvidence: false };
      return Response.json({
        model: "meterless/fast",
        choices: [{ message: { content: JSON.stringify(value) } }],
      });
    };
    const results = await runPreflight({ live: true, component: "inference" });
    assert.ok(
      results.some(
        (r) =>
          r.name === "nightshift Planner/Critic inference" &&
          r.status === "PASS",
      ),
    );
    assert.ok(
      results.some(
        (r) =>
          r.name === "Nemotron response identity" && r.status === "UNVERIFIED",
      ),
    );
    globalThis.fetch = async () => new Response("", { status: 403 });
    const unauthorized = await runPreflight({
      live: true,
      component: "inference",
    });
    assert.match(unauthorized[0].detail, /nightshift_unauthorized/);
  } finally {
    globalThis.fetch = original;
    restore();
  }
});

test("preflight keeps sample mode offline even with configured sponsor values", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      assert.fail("Offline preflight attempted network");
    };
    const results = await runPreflight({ live: false });
    assert.ok(
      results.some((r) => r.name.startsWith("H-MEM") && r.status === "PASS"),
    );
    assert.ok(
      results.some(
        (r) => r.name === "Live sponsors" && r.status === "UNVERIFIED",
      ),
    );
    assert.ok(!results.some((r) => r.status === "FAIL"));
  } finally {
    globalThis.fetch = original;
  }
});
