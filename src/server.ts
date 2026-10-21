import { createApp } from "./app.ts";
import { loadEnvironment } from "./config.ts";
loadEnvironment();
const { app, config } = await createApp();
await app.listen({ host: config.host, port: config.port });
console.log(
  `ROVER Relay: http://${config.host}:${config.port} | ${config.sample ? "OFFLINE SAMPLE" : "LIVE SPONSOR ADAPTERS"} | simulated operations`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
