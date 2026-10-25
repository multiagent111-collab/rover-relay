import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../../src/app.ts";
import { configuration } from "../../src/config.ts";

// Explicit disposable browser verification only; never loads .env or live state.
const directory = await mkdtemp(join(tmpdir(), "relay-browser-test-"));
for (const name of [
  "DATABASE_URL",
  "RELAY_ACCESS_TOKEN",
  "ZETARIS_REST_URL",
  "ZETARIS_API_KEY",
  "ZETARIS_ORG_ID",
  "NVIDIA_API_KEY",
  "METERLESS_BASE_URL",
  "METERLESS_RUNTIME_TOKEN",
  "METERLESS_ROUTE",
  "NEMOTRON_MODEL",
])
  delete process.env[name];
process.env.RELAY_INFERENCE_PROVIDER = "nvidia";
globalThis.fetch = async () => {
  throw Error("Browser verification cannot call an external service");
};
const common = {
  ...configuration(),
  databaseUrl: "",
  accessToken: "relay-browser-test-access-only",
  demo: false,
  planTtlSeconds: 1800,
};
const sample = await createApp({
  config: {
    ...common,
    sample: true,
    demo: true,
    dataDir: join(directory, "sample"),
  },
});
const authentication = await createApp({
  config: {
    ...common,
    sample: false,
    dataDir: join(directory, "authentication"),
  },
});
// Library planning is deliberately slow in this test fixture so the browser
// can exercise Stop waiting and persisted failure recovery at a real HTTP boundary.
const generate = sample.service.generator.generate.bind(
  sample.service.generator,
);
sample.service.generator.generate = async (role, input, signal) => {
  if (input.request.destination === "library")
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(done, 10000);
      function done() {
        signal.removeEventListener("abort", aborted);
        resolve();
      }
      function aborted() {
        clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
        reject(new DOMException("Test planning cancelled", "AbortError"));
      }
      if (signal.aborted) aborted();
      else signal.addEventListener("abort", aborted, { once: true });
    });
  return generate(role, input, signal);
};
const control = `/__browser_test_stop_${randomUUID()}`;
sample.app.post(control, async (_request, reply) => {
  reply.send({ stopping: true });
  setImmediate(() => {
    void shutdown();
  });
});
async function shutdown() {
  await Promise.all([sample.app.close(), authentication.app.close()]);
  const actual = await realpath(directory),
    parent = await realpath(tmpdir());
  if (
    dirname(actual).toLowerCase() !== parent.toLowerCase() ||
    !actual.split(/[\\/]/).at(-1)!.startsWith("relay-browser-test-")
  )
    throw Error("Unsafe browser test cleanup");
  await rm(actual, { recursive: true, force: true });
  console.log(
    "Disposable browser instances stopped; verified test-owned data removed.",
  );
}
await sample.app.listen({ host: "127.0.0.1", port: 0 });
await authentication.app.listen({ host: "127.0.0.1", port: 0 });
console.log(
  JSON.stringify({
    sample: sample.app.listeningOrigin,
    authentication: authentication.app.listeningOrigin,
    stopPath: control,
    mode: "disposable browser verification; no hosted calls",
    authenticationToken:
      "fixed non-secret test fixture documented in helper source",
  }),
);
