import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = resolve(root, "vendor/hmem");
const manifest = JSON.parse(
  await readFile(resolve(vendor, "INTEGRITY.json"), "utf8"),
);
const revision = "1742dec56a66e58eef9dda2d2b865823758ca8cd";
if (manifest.revision !== revision)
  throw new Error("Unexpected H-MEM manifest revision.");
const pending = [];
for (const file of manifest.files) {
  const upstream =
    file.path === "LICENSE"
      ? "LICENSE"
      : file.path.startsWith("conformance/")
        ? `engines/hmem/${file.path}`
        : `engines/hmem/reference/${file.path}`;
  const response = await fetch(
    `https://raw.githubusercontent.com/Meterless/Meterless/${revision}/${upstream}`,
    {
      signal: AbortSignal.timeout(30000),
      headers: { "User-Agent": "rover-relay-setup" },
    },
  );
  if (!response.ok)
    throw new Error(`H-MEM download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha = createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest("hex");
  if (sha !== file.gitBlobSha1)
    throw new Error(`Upstream integrity mismatch: ${file.path}`);
  pending.push({ path: resolve(vendor, file.path), bytes });
}
for (const file of pending) {
  await mkdir(dirname(file.path), { recursive: true });
  await writeFile(file.path, file.bytes);
}
console.log(
  `Provisioned official H-MEM and conformance suite: ${pending.length} verified files at ${revision}.`,
);
