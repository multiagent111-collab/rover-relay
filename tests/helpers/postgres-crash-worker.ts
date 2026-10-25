import { createApp } from "../../src/app.ts";
import { configuration } from "../../src/config.ts";
import type { Mission } from "../../src/types.ts";
const [phase, directory, missionId, key] = process.argv.slice(2);
if (
  !process.env.RELAY_PG_TEST_RUN ||
  !process.env.RELAY_PG_TEST_URL ||
  !directory ||
  !missionId ||
  !key ||
  !["approval", "outbox"].includes(phase)
)
  throw Error("Isolated PostgreSQL worker arguments required");
globalThis.fetch = async () => {
  throw Error("Offline PostgreSQL test attempted external fetch");
};
const { app, service } = await createApp({
  config: {
    ...configuration(),
    sample: true,
    demo: true,
    databaseUrl: process.env.RELAY_PG_TEST_URL,
    dataDir: directory,
    planTtlSeconds: 1800,
  },
});
const crash = async (boundary: string) => {
  await new Promise<void>((resolve, reject) =>
    process.send!({ boundary, pid: process.pid }, (error) =>
      error ? reject(error) : resolve(),
    ),
  );
  // Deliberately bypass close hooks. PostgreSQL has acknowledged COMMIT.
  process.exit(73);
};
if (phase === "outbox") await crash("outbox_committed_before_response");
service.drainOutbox = () => crash("approval_committed_before_response");
const mission = (
  await app.inject({ url: `/v1/missions/${missionId}` })
).json<Mission>();
await app.inject({
  method: "POST",
  url: `/v1/missions/${missionId}/approve`,
  payload: {
    version: mission.receipt!.version,
    digest: mission.receipt!.digest,
    idempotencyKey: key,
  },
});
throw Error("Crash boundary was not reached");
