import { loadEnvironment } from "../src/config.ts";
import { runPreflight, type Component } from "../src/preflight.ts";

loadEnvironment();
const args = process.argv.slice(2);
const component =
  args.find((arg) => arg.startsWith("--component="))?.split("=")[1] || "all";
if (
  !["all", "memory", "inference", "zetaris"].includes(component) ||
  args.some(
    (arg) =>
      arg !== "--live" && arg !== "--json" && !arg.startsWith("--component="),
  )
) {
  console.error(
    "Usage: preflight [--live] [--json] [--component=all|memory|inference|zetaris]",
  );
  process.exit(2);
}
// Service calls always require an explicit flag, including with a live .env.
const live = args.includes("--live");
const results = await runPreflight({ live, component: component as Component });
if (args.includes("--json"))
  console.log(
    JSON.stringify(
      { checkedAt: new Date().toISOString(), live, results },
      null,
      2,
    ),
  );
else
  for (const result of results)
    console.log(
      `${result.status} ${result.name}: ${result.detail} [${result.checkedAt}]`,
    );
if (
  results.some(
    (result) =>
      result.status === "FAIL" || (live && result.status === "UNVERIFIED"),
  )
)
  process.exitCode = 1;
