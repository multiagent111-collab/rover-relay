import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const tag = "rover-relay-pre-event-2026-10-21";
const manifestPath = "docs/SOURCE_MANIFEST.json";
const git = (...args) => execFileSync("git", args, { maxBuffer: 20 * 1024 * 1024 });
const paths = buffer => buffer.toString("utf8").split("\0").filter(Boolean).filter(p => p !== manifestPath).sort();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

if (process.argv.includes("--write")) {
  const files = paths(git("ls-files", "-z")).map(path => ({ path, sha256: hash(git("show", `:${path}`)) }));
  const manifest = {
    schemaVersion: "1.0", preExistingWork: true, baselineTag: tag,
    buildOpensAt: "2026-10-22T00:00:00Z", snapshotPreparedAt: new Date().toISOString(),
    content: "Git-stored bytes; manifest excludes itself to avoid a circular hash. Commit covers manifest.", files,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Generated pre-event inventory of ${files.length} Git-staged files.`);
} else {
  const manifest = JSON.parse(git("show", `${tag}:${manifestPath}`).toString("utf8"));
  const names = paths(git("ls-tree", "-r", "--name-only", "-z", tag));
  if (JSON.stringify(names) !== JSON.stringify(manifest.files.map(f => f.path))) throw new Error("Baseline inventory does not match tagged tree.");
  for (const file of manifest.files)
    if (hash(git("show", `${tag}:${file.path}`)) !== file.sha256) throw new Error(`Baseline content mismatch: ${file.path}`);
  console.log(`PASS baseline ${tag}: ${names.length} files match the committed SHA-256 inventory.`);
}
