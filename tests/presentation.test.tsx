import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { seedFixtures } from "../src/fixtures.ts";
import { sampleEvidence } from "../src/evidence.ts";
import {
  visibleMissions,
  receiptMap,
  inferenceLabel,
} from "../ui/presentation.ts";
import { ChangeComparison, ApprovalTerms } from "../ui/receipt-details.tsx";
import { requestJson, RequestError, sessionToken } from "../ui/request.ts";
import type { Mission, Receipt } from "../src/types.ts";

test("mission history is chronological with stable ties, ownership-independent filtering and access beyond four rows", () => {
  const missions = ["z", "b", "a", "c", "d", "e", "f"].map(
    (id, i) =>
      ({
        id,
        createdAt: i === 0 ? "2026-10-21T01:00:00Z" : "2026-10-22T01:00:00Z",
        status: i === 3 ? "dependency_unavailable" : "completed",
        request: { destination: "auditorium" },
      }) as Mission,
  );
  assert.deepEqual(
    visibleMissions(missions, "", "all").map((m) => m.id),
    ["a", "b", "c", "d", "e", "f", "z"],
  );
  assert.equal(visibleMissions(missions, "auditorium", "completed").length, 6);
  assert.equal(
    visibleMissions(missions, "", "dependency_unavailable")[0].id,
    "c",
  );
  assert.equal(visibleMissions(missions, "2026-10-21", "all")[0].id, "z");
  assert.equal(missions[0].id, "z");
});
test("live maps use fresh receipt route facts and never substitute sample stock/couriers/edges", () => {
  const fixtures = seedFixtures(),
    now = Date.parse("2026-10-22T01:00:00Z");
  const receipt = {
    mode: "live_sponsors",
    evidence: sampleEvidence(fixtures, new Date(now).toISOString()).map(
      (e) => ({ ...e, mode: "live_sponsors" }),
    ),
    candidates: [],
  } as unknown as Receipt;
  fixtures.edges[0].closed = true;
  const map = receiptMap("live_sponsors", fixtures, receipt, now);
  assert.equal(map.fixtures!.edges[0].closed, false);
  assert.deepEqual(map.fixtures!.couriers, []);
  assert.deepEqual(map.fixtures!.suppliers, []);
  assert.equal(
    receiptMap(undefined, fixtures, receipt, now).fixtures,
    undefined,
  );
  assert.equal(
    receiptMap("live_sponsors", fixtures, undefined, now).fixtures,
    undefined,
  );
  const mixed = structuredClone(receipt);
  mixed.evidence.find((e) => e.kind === "route_edge")!.mode = "offline_sample";
  assert.equal(
    receiptMap("live_sponsors", fixtures, mixed, now).fixtures,
    undefined,
  );
  assert.equal(
    receiptMap("live_sponsors", fixtures, receipt, now + 60001).fixtures,
    undefined,
  );
  assert.equal(
    receiptMap("live_sponsors", fixtures, receipt, now - 5001).fixtures,
    undefined,
  );
  const unknown = structuredClone(receipt);
  unknown.evidence.find((e) => e.kind === "route_edge")!.facts!.from =
    "unmapped-live-node";
  assert.equal(
    receiptMap("live_sponsors", fixtures, unknown, now).fixtures,
    undefined,
  );
  assert.equal(
    receiptMap("offline_sample", fixtures, undefined, now).fixtures,
    fixtures,
  );
});
test("NVIDIA direct, Runtime, sample and unresolved inference labels stay distinct", () => {
  assert.equal(inferenceLabel("nvidia-direct"), "NVIDIA direct");
  assert.equal(inferenceLabel("meterless-nightshift"), "Nightshift Runtime");
  assert.match(inferenceLabel("sample"), /no hosted inference/);
  assert.equal(inferenceLabel(), "Not observed");
});
test("changed-plan and approval views render deterministic terms, IDs and fresh confirmation without trusting summary text", () => {
  const terms = {
    candidateId: "s:c",
    supplierId: "s",
    courierId: "c",
    quantity: 2,
    unitPriceCents: 1200,
    deliveryCents: 800,
    totalCents: 3200,
    etaMinutes: 22,
    routeEdges: ["E1"],
    entrance: "North test door",
  };
  const mission = {
    id: "test-mission",
    deadlineAt: "2026-10-22T01:30:00Z",
    receipt: {
      version: 2,
      digest: "current-digest",
      expiresAt: "2026-10-22T01:01:00Z",
      summary: "Invented total $9999 <script>unsafe</script>",
      sourceFingerprint: "source-id",
      memoryRevision: "memory-revision",
      memory: { records: [{ id: "record-id" }] },
      changeDetails: {
        schemaVersion: "change-1.0",
        reasons: ["price_changed"],
        previous: { version: 1, digest: "original-digest", terms },
        current: {
          version: 2,
          terms: { ...terms, totalCents: 3300, unitPriceCents: 1250 },
        },
        sourceChanges: [],
        memory: {},
        originalDeadlineAt: "2026-10-22T01:30:00Z",
      },
    },
  } as unknown as Mission;
  const html = renderToStaticMarkup(
    <>
      <ChangeComparison mission={mission} />
      <ApprovalTerms mission={mission} task={null} />
    </>,
  );
  assert.match(html, /\$32\.00/);
  assert.match(html, /\$33\.00/);
  assert.match(html, /Fresh approval required/);
  assert.match(html, /current-digest/);
  assert.match(html, /original-digest/);
  assert.match(html, /record-id/);
  assert.doesNotMatch(html, /9999|<script>/);
});
test("browser requests prevent later mutations after cancellation and keep network/auth failures actionable", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      throw Error("private upstream diagnostic");
    };
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      requestJson(
        "/v1/intakes/test/confirm",
        "POST",
        {},
        "",
        controller.signal,
      ),
      (e) => (e as Error).name === "AbortError",
    );
    assert.equal(calls, 0);
    await assert.rejects(
      requestJson("/v1/bootstrap", "GET", undefined, ""),
      (e) =>
        e instanceof RequestError &&
        e.code === "connection_failed" &&
        !e.message.includes("private upstream"),
    );
    globalThis.fetch = async (_url, init) => {
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer local-test-only",
      );
      return new Response(
        JSON.stringify({
          error: "unauthorized",
          message: "A valid Relay access token is required.",
        }),
        { status: 401 },
      );
    };
    await assert.rejects(
      requestJson("/v1/bootstrap", "GET", undefined, "local-test-only"),
      (e) => e instanceof RequestError && e.status === 401,
    );
    assert.equal(sessionToken(), "");
  } finally {
    globalThis.fetch = original;
  }
});
