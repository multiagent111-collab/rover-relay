import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryAdapter, HMEM_REVISION } from "./memory.ts";
import { liveGenerator, normalizeRuntimeUrl, reason } from "./agents.ts";
import { ZetarisData, boundedJson } from "./adapters/data.ts";
import { seedFixtures } from "./fixtures.ts";
import { enumerateCandidates } from "./domain.ts";
import { inferenceProvider, requireEnvironment } from "./config.ts";
import { RelayError } from "./types.ts";

export type Probe = {
  status: "PASS" | "FAIL" | "UNVERIFIED";
  name: string;
  detail: string;
};
export type Component = "all" | "memory" | "inference" | "zetaris";

export async function runPreflight(options: {
  live: boolean;
  component?: Component;
}): Promise<Probe[]> {
  const results: Probe[] = [];
  const report = (status: Probe["status"], name: string, detail: string) =>
    results.push({ status, name, detail });
  // Never print arbitrary upstream errors, model text, or credential values.
  const attempt = async (name: string, action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      report(
        "FAIL",
        name,
        error instanceof RelayError
          ? `${error.code}: ${error.message}`
          : "Check failed; no upstream response or credentials have been logged.",
      );
    }
  };
  const component = options.component || "all";
  const selected = (name: Component) =>
    component === "all" || component === name;
  const identity = { tenant: "relay-demo", user: "preflight" };
  if (selected("memory"))
    await attempt("H-MEM", async () => {
      const directory = await mkdtemp(join(tmpdir(), "relay-preflight-"));
      try {
        new MemoryAdapter(directory).set(
          identity,
          "auditorium",
          "Preflight loading door",
        );
        const memory = new MemoryAdapter(directory);
        if (
          memory.recall(identity, "auditorium").entrance !==
          "Preflight loading door"
        )
          throw new Error("Recall failed");
        memory.set(identity, "auditorium", "Corrected loading door");
        if (
          new MemoryAdapter(directory).recall(identity, "auditorium")
            .entrance !== "Corrected loading door"
        )
          throw new Error("Correction failed");
        memory.forget(identity, "auditorium");
        if (
          new MemoryAdapter(directory).recall(identity, "auditorium")
            .entrance !== null
        )
          throw new Error("Forget failed");
        report(
          "PASS",
          "H-MEM persistence, correction and forgetting",
          HMEM_REVISION,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  if (!options.live) {
    report(
      "UNVERIFIED",
      "Live sponsors",
      "Offline sample mode: no external calls attempted. Use preflight:live to test configured services.",
    );
    return results;
  }
  if (component === "all")
    report(
      (process.env.RELAY_ACCESS_TOKEN || "").length >= 24 ? "PASS" : "FAIL",
      "Relay access token",
      "Live API requires a separate token of at least 24 characters (value hidden).",
    );
  if (selected("inference"))
    await attempt("Inference", async () => {
      const provider = inferenceProvider();
      requireEnvironment(
        provider === "nightshift"
          ? [
              "METERLESS_BASE_URL",
              "METERLESS_RUNTIME_TOKEN",
              "METERLESS_ROUTE",
              "NEMOTRON_MODEL",
            ]
          : ["NVIDIA_API_KEY", "NEMOTRON_MODEL"],
      );
      const model = process.env.NEMOTRON_MODEL!.trim();
      if (!/^nvidia\/[a-z0-9.-]*nemotron[a-z0-9.-]*$/i.test(model))
        throw new RelayError(
          503,
          "invalid_configuration",
          "Expected model must be an NVIDIA Nemotron ID.",
        );
      if (provider === "nightshift") {
        const response = await fetch(
          `${normalizeRuntimeUrl(process.env.METERLESS_BASE_URL!)}/models`,
          {
            headers: {
              Authorization: `Bearer ${process.env.METERLESS_RUNTIME_TOKEN}`,
              "meterless-app": "rover-relay",
            },
            signal: AbortSignal.timeout(10000),
          },
        );
        if (!response.ok)
          throw new RelayError(
            503,
            response.status === 401 || response.status === 403
              ? "nightshift_unauthorized"
              : "nightshift_unavailable",
            `Nightshift discovery returned HTTP ${response.status}.`,
          );
        const body = (await boundedJson(response)) as {
          data?: { id?: string }[];
        };
        if (
          !Array.isArray(body?.data) ||
          !body.data.some((item) => item?.id === process.env.METERLESS_ROUTE)
        )
          throw new RelayError(
            503,
            "nightshift_route_missing",
            "Configured route does not appear in authenticated /v1/models discovery.",
          );
        report(
          "PASS",
          "Nightshift route discovery",
          "Configured route exists; this does not establish the underlying model.",
        );
      }
      const request = {
        sku: "HDMI-USB-C" as const,
        quantity: 2,
        destination: "auditorium" as const,
        budgetCents: 3500,
        deadlineMinutes: 30,
      };
      const candidates = enumerateCandidates(seedFixtures(), request, [
        "preflight-synthetic-data",
      ]);
      const input = {
        request,
        candidates,
        memory: {
          records: [],
          context: "",
          entrance: null,
          revision: "",
          engine: "preflight",
        },
      };
      const result = await reason(
        liveGenerator(),
        input,
        async () => candidates,
        AbortSignal.timeout(120000),
      );
      const calls = result.steps.filter((step) => step.role !== "Validator");
      report(
        "PASS",
        `${provider} Planner/Critic inference`,
        `Validated proposal from ${calls.length} actual model calls over synthetic preflight data; no dispatch created.`,
      );
      const attributed =
        calls.length > 0 && calls.every((call) => call.model === model);
      report(
        attributed ? "PASS" : "UNVERIFIED",
        "Nemotron response identity",
        attributed
          ? "Every Planner/Critic response reports the configured Nemotron model."
          : "Response identity does not establish the expected Nemotron model. Correlate Nightshift receipts with the underlying provider before claiming verification.",
      );
    });
  // Check SQL access independently from model credentials and operational views.
  if (selected("zetaris")) {
    const data = new ZetarisData();
    await attempt("Zetaris authenticated SQL", async () => {
      const result = await data.query("SELECT 1 AS relay_connection_check");
      const first = result.rows[0];
      const value = Array.isArray(first)
        ? first[0]
        : first && typeof first === "object"
          ? Object.values(first)[0]
          : undefined;
      if (Number(value) !== 1)
        throw new RelayError(
          503,
          "zetaris_contract",
          "SELECT 1 did not return the expected value.",
        );
      report(
        "PASS",
        "Zetaris authenticated SQL",
        `SELECT 1 succeeded; query ${result.queryId}.`,
      );
    });
    await attempt("Zetaris operational views", async () => {
      const snapshot = await data.snapshot(identity);
      if (
        !snapshot.fixtures.suppliers.length ||
        !snapshot.fixtures.couriers.length ||
        !snapshot.fixtures.edges.length
      )
        throw new RelayError(
          503,
          "zetaris_empty_views",
          "Views must contain suppliers, couriers and routes.",
        );
      report(
        "PASS",
        "Zetaris operational views",
        `${snapshot.evidence.length} evidence records. Preserve connector/query evidence to demonstrate federation.`,
      );
    });
  }
  return results;
}
