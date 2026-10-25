import { spawnSync } from "node:child_process";
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "scripts/public-review.ts", ...process.argv.slice(2)],
  { stdio: "inherit", windowsHide: true },
);
if (result.error)
  console.error(
    "Public source review could not start; no candidate is considered reviewed.",
  );
process.exitCode = result.status ?? 1;
