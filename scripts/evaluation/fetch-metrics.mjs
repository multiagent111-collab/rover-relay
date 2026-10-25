// Preload only in the explicitly authorized live verifier child. No bodies,
// headers, credentials, URLs or unrelated Runtime receipts are recorded.
import { writeFileSync } from "node:fs";
const original = globalThis.fetch,
  calls = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  const runtime = process.env.METERLESS_BASE_URL;
  const zetaris = process.env.ZETARIS_REST_URL;
  const matches = (base) => {
    try {
      return (
        new URL(/^https?:/.test(base) ? base : "http://" + base).origin ===
        url.origin
      );
    } catch {
      return false;
    }
  };
  const service =
    runtime && matches(runtime)
      ? "nightshift"
      : zetaris && matches(zetaris)
        ? "zetaris"
        : "other";
  const operation =
    service === "nightshift"
      ? url.pathname.endsWith("/chat/completions")
        ? "inference"
        : url.pathname.endsWith("/models")
          ? "discovery"
          : "receipt_read"
      : service === "zetaris"
        ? "source_read"
        : "unknown";
  const started = performance.now(),
    record = {
      service,
      operation,
      method: init?.method || "GET",
      status: null,
      durationMs: null,
      outcome: "unresolved",
    };
  calls.push(record);
  try {
    const response = await original(input, init);
    record.status = response.status;
    record.outcome = response.ok ? "http_success" : "http_failure";
    return response;
  } catch (error) {
    record.outcome =
      error?.name === "TimeoutError" || error?.name === "AbortError"
        ? "timeout_or_abort"
        : "transport_failure";
    throw error;
  } finally {
    record.durationMs = Math.round(performance.now() - started);
  }
};
process.on("exit", () => {
  if (process.env.RELAY_EVALUATION_METRICS)
    writeFileSync(
      process.env.RELAY_EVALUATION_METRICS,
      JSON.stringify({
        kind: "actual_sponsor_http_counts",
        scope:
          "Relay HTTP attempts only; Runtime-internal provider fan-out is not counted. Individual fetch durations end at response headers; verifier missionElapsedMs is end-to-end.",
        calls,
        totalCalls: calls.length,
        inferenceCalls: calls.filter((c) => c.operation === "inference").length,
      }),
      { flag: "wx" },
    );
});
