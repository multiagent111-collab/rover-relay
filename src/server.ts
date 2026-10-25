import { createApp } from "./app.ts";
import { loadEnvironment, configuration } from "./config.ts";
import { assertPortAvailable } from "./lifecycle.ts";
import { RelayError } from "./types.ts";
loadEnvironment();
let opened: Awaited<ReturnType<typeof createApp>> | undefined;
try {
  const desired = configuration();
  await assertPortAvailable(desired.host, desired.port);
  opened = await createApp({ config: desired });
  await opened.app.listen({ host: desired.host, port: desired.port });
} catch (error) {
  await opened?.app.close();
  console.error(
    error instanceof RelayError
      ? `${error.code}: ${error.message}`
      : "Relay startup failed. Check configuration, database availability and the local status command; credentials and raw errors are hidden.",
  );
  process.exit(1);
}
const { app, config } = opened!;
console.log(
  `ROVER Relay: http://${config.host}:${config.port} | ${config.sample ? "OFFLINE SAMPLE" : "LIVE SPONSOR ADAPTERS"} | simulated operations`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
