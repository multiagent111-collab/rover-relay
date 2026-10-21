import { loadEnvironment, configuration } from "../src/config.ts";
import { runPreflight, type Component } from "../src/preflight.ts";

loadEnvironment();
const args = process.argv.slice(2);
const component =
  args.find((arg) => arg.startsWith("--component="))?.split("=")[1] || "all";
if (
  !["all", "memory", "inference", "zetaris"].includes(component) ||
  args.some((arg) => arg !== "--live" && !arg.startsWith("--component="))
) {
  console.error(
    "Usage: preflight [--live] [--component=all|memory|inference|zetaris]",
  );
  process.exit(2);
}
const live = args.includes("--live") || !configuration().sample;
const results = await runPreflight({ live, component: component as Component });
for (const result of results)
  console.log(`${result.status} ${result.name}: ${result.detail}`);
if (
  results.some(
    (result) =>
      result.status === "FAIL" || (live && result.status === "UNVERIFIED"),
  )
)
  process.exitCode = 1;
