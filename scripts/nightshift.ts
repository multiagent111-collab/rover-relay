import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { configuration, loadEnvironment } from "../src/config.ts";
import { createApp } from "../src/app.ts";
import { normalizeRuntimeUrl } from "../src/agents.ts";
import { boundedJson } from "../src/adapters/data.ts";
import { nemotronRoute } from "../src/runtime-proof.ts";
import { RelayError, type Mission, type AgentStep } from "../src/types.ts";

// An explicit, isolated full planning check. Never rewrites .env, changes the
// running app/provider, edits Runtime policy, approves a dispatch or retries a
// failed mission. Live Zetaris reads and model calls consume service quota.
const args = process.argv.slice(2);
const output = args.find((a) => a.startsWith("--output="))?.slice(9);
if (
  !args.includes("--live") ||
  args.some(
    (a) =>
      a !== "--live" &&
      a !== "--accept-routed-nemotron" &&
      !a.startsWith("--output="),
  )
) {
  console.error(
    "Usage: npm run verify:nightshift -- --live [--accept-routed-nemotron] [--output=report.json]. Uses real services, isolated temporary state, no dispatch.",
  );
  process.exit(2);
}
if (
  output &&
  (!output.toLowerCase().endsWith(".json") || existsSync(resolve(output)))
) {
  console.error(
    "Choose a new .json report path; an existing report or configuration file will not be overwritten. No service was called.",
  );
  process.exit(2);
}
loadEnvironment();
const previousProvider = process.env.RELAY_INFERENCE_PROVIDER;
process.env.RELAY_INFERENCE_PROVIDER = "nightshift";
const directory = await mkdtemp(join(tmpdir(), "relay-nightshift-"));
let opened: Awaited<ReturnType<typeof createApp>> | undefined;
const report: Record<string, unknown> = {
  ticket: "RELAY-05",
  startedAt: new Date().toISOString(),
  kind: "actual Nightshift planning mission; live Zetaris reads; isolated SQLite and official H-MEM; no dispatch",
  requestedRoute: process.env.METERLESS_ROUTE,
  expectedModelLabel: process.env.NEMOTRON_MODEL,
  modelPolicy: args.includes("--accept-routed-nemotron")
    ? "explicitly accept Runtime-routed NVIDIA Nemotron family; exact picked models recorded"
    : "exact expected-model match",
  existingProviderPreserved: previousProvider,
  checks: [],
};
const start = performance.now();
const callSteps: AgentStep[] = [];
try {
  const base = normalizeRuntimeUrl(process.env.METERLESS_BASE_URL || "");
  const headers = {
    Authorization: `Bearer ${process.env.METERLESS_RUNTIME_TOKEN || ""}`,
    "meterless-app": "rover-relay",
  };
  const discovery = await fetch(`${base}/models`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  const models = (await boundedJson(discovery)) as { data?: { id?: string }[] };
  if (
    !discovery.ok ||
    !models.data?.some((m) => m.id === process.env.METERLESS_ROUTE)
  )
    throw new RelayError(
      503,
      "nightshift_route_missing",
      "Authenticated discovery did not return the configured route.",
    );
  report.discovery = { status: discovery.status, configuredRouteFound: true };
  const config = {
    ...configuration(),
    sample: false,
    demo: false,
    databaseUrl: "",
    dataDir: directory,
  };
  opened = await createApp({ config });
  // Capture only the existing service's safe structured decisions, including
  // failure paths. The normal HTTP API still performs the complete mission.
  const auth = { Authorization: `Bearer ${config.accessToken}` };
  const preference = await opened.app.inject({
    method: "PUT",
    url: "/v1/preferences/entrance",
    headers: auth,
    payload: { venue: "auditorium", entrance: "North loading entrance" },
  });
  if (preference.statusCode !== 200)
    throw new RelayError(
      503,
      "nightshift_check_setup",
      "Isolated confirmed preference could not be saved.",
    );
  const missionStart = performance.now();
  const response = await opened.app.inject({
    method: "POST",
    url: "/v1/missions",
    headers: auth,
    payload: {
      sku: "HDMI-USB-C",
      quantity: 2,
      destination: "auditorium",
      budgetCents: 3500,
      deadlineMinutes: 30,
    },
  });
  report.missionElapsedMs = Math.round(performance.now() - missionStart);
  report.httpStatus = response.statusCode;
  const state = await opened.service.store.read();
  const mission = Object.values(state.missions).at(-1);
  if (mission) {
    report.missionId = mission.id;
    report.status = mission.status;
    report.createdAt = mission.createdAt;
    report.deadlineAt = mission.deadlineAt;
    for (const event of state.events.filter(
      (e) => e.missionId === mission.id && e.type === "agent_step",
    ))
      callSteps.push(event.data as AgentStep);
    report.steps = callSteps;
    report.budget = state.events
      .filter((e) => e.missionId === mission.id && e.type === "planning_budget")
      .at(-1)?.data;
  }
  report.tasksCreated = Object.keys(state.tasks).length;
  if (response.statusCode !== 201) {
    const code = response.json().error;
    throw new RelayError(
      503,
      typeof code === "string" && /^[a-z_]{1,64}$/.test(code)
        ? code
        : "nightshift_mission_failed",
      "Nightshift mission failed; no automatic retry or provider fallback was attempted.",
    );
  }
  const result = response.json<Mission>(),
    receipt = result.receipt!;
  report.receipt = {
    version: receipt.version,
    digest: receipt.digest,
    createdAt: receipt.createdAt,
    expiresAt: receipt.expiresAt,
    selectedId: receipt.selectedId,
    summary: receipt.summary,
    review: receipt.review,
    coordination: receipt.coordination,
    memory: {
      engine: receipt.memory.engine,
      entrance: receipt.memory.entrance,
      recordIds: receipt.memory.records.map((r) => r.id),
    },
    sourceQueries: [
      ...new Set(receipt.evidence.map((e) => e.queryId).filter(Boolean)),
    ],
    evidenceCount: receipt.evidence.length,
  };
  const calls = receipt.steps.filter((s) => s.role !== "Validator");
  if (
    !receipt.selectedId ||
    !calls.length ||
    calls.some(
      (s) =>
        s.provider !== "meterless-nightshift" ||
        !nemotronRoute(s.routing) ||
        s.routing!.app !== "rover-relay",
    )
  )
    throw new RelayError(
      503,
      "nightshift_provenance_unverified",
      "A full checked plan lacks consistent Runtime-reported NVIDIA Nemotron evidence for every model response.",
    );
  const exact = calls.every(
    (s) => s.routing!.routedModel === process.env.NEMOTRON_MODEL,
  );
  report.expectedModelLabelMatched = exact;
  if (!exact && !args.includes("--accept-routed-nemotron"))
    throw new RelayError(
      503,
      "nightshift_model_mismatch",
      "Runtime selected a different model than the expected label. Review routing evidence; an expected label is not a routing pin.",
    );
  const logs = await fetch(`${base}/meterless/receipts?limit=100`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  const persisted = (await boundedJson(logs)) as {
    data?: {
      body?: {
        receipt?: {
          request_id?: string;
          receipt_id?: string;
          winning_route?: { model?: string; provider?: string };
        };
      };
    }[];
  };
  const correlations = calls.map((s) => {
    const matched = persisted.data?.find(
      (e) =>
        e.body?.receipt?.request_id === s.requestId &&
        e.body?.receipt?.receipt_id === s.routing!.receiptId &&
        e.body.receipt.winning_route?.model === s.routing!.routedModel &&
        e.body.receipt.winning_route.provider === s.routing!.provider,
    );
    return {
      responseId: s.requestId,
      receiptId: s.routing!.receiptId,
      receiptLogMatched: !!matched,
      routedModel: s.routing!.routedModel,
      provider: s.routing!.provider,
      fromCache: s.routing!.fromCache,
    };
  });
  report.receiptCorrelations = correlations;
  if (!logs.ok || correlations.some((c) => !c.receiptLogMatched))
    throw new RelayError(
      503,
      "nightshift_receipt_unavailable",
      "A response receipt was not correlated with the Runtime receipt log.",
    );
  report.result = "pass";
  report.scope =
    "Runtime-reported identities correlated with its persisted receipt log, not independent NVIDIA attestation or cryptographic signature verification. No real booking, dispatch approval or configuration change.";
} catch (error) {
  report.result = "fail";
  report.errorCode =
    error instanceof RelayError ? error.code : "nightshift_check_failed";
  report.message =
    error instanceof RelayError
      ? error.message
      : "Check failed; credentials and raw provider output are hidden.";
  process.exitCode = 1;
} finally {
  report.elapsedMs = Math.round(performance.now() - start);
  report.completedAt = new Date().toISOString();
  await opened?.app.close();
  if (!directory.startsWith(join(tmpdir(), "relay-nightshift-")))
    throw Error("Unexpected cleanup target");
  await rm(directory, { recursive: true, force: true });
  if (previousProvider === undefined)
    delete process.env.RELAY_INFERENCE_PROVIDER;
  else process.env.RELAY_INFERENCE_PROVIDER = previousProvider;
}
if (output)
  await writeFile(resolve(output), JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
console.log(JSON.stringify(report, null, 2));
