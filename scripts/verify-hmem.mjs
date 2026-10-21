import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "vendor/hmem");
const manifest = JSON.parse(
  readFileSync(join(vendor, "INTEGRITY.json"), "utf8"),
);
const metadata = JSON.parse(
  readFileSync(join(vendor, "UPSTREAM.json"), "utf8"),
);
if (manifest.revision !== metadata.revision)
  throw new Error("H-MEM revision mismatch.");
for (const file of manifest.files) {
  const bytes = readFileSync(join(vendor, file.path));
  const actual = createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest("hex");
  if (actual !== file.gitBlobSha1)
    throw new Error(`H-MEM source differs from upstream: ${file.path}`);
}
for (const file of readdirSync(join(vendor, "src"), { recursive: true })) {
  if (
    String(file).endsWith(".ts") &&
    !manifest.files.some(
      (item) => item.path === `src/${String(file).replaceAll("\\", "/")}`,
    )
  )
    throw new Error(`Unrecorded H-MEM source file: ${file}`);
}
console.log(
  `PASS upstream source integrity: ${manifest.files.length} files, ${manifest.revision}`,
);
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", join(vendor, "conformance/runner.ts")],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, HMEM_IMPL: join(vendor, "src/index.ts") },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
