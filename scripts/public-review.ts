import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const credentialPattern =
  /(?:nvapi-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|d(?:ckr|ockr)_pat_[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
export function reviewPublic(root: string) {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  const tracked = git("ls-files", "-z").split("\0").filter(Boolean);
  const candidates = [
    ...new Set([
      ...tracked,
      ...git("ls-files", "--others", "--exclude-standard", "-z")
        .split("\0")
        .filter(Boolean),
    ]),
  ].sort();
  const findings: { path: string; reason: string }[] = [],
    files: { path: string; bytes: number; sha256: string }[] = [];
  for (const path of candidates) {
    if (
      /(^|\/)(node_modules|dist|\.data|\.git)(?:\/|$)|\.sqlite(?:[.-].*)?$|(^|\/)\.npmrc$|\.(pem|p12|pfx)$/i.test(
        path,
      ) ||
      (/(^|\/)\.env(?:\.|$)/.test(path) && path !== ".env.example")
    ) {
      findings.push({ path, reason: "excluded runtime/configuration path" });
      continue;
    }
    const target = resolve(root, path),
      stat = lstatSync(target, { throwIfNoEntry: false });
    if (!stat) {
      findings.push({ path, reason: "missing candidate" });
      continue;
    }
    if (
      !target.startsWith(resolve(root) + sep) ||
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      !realpathSync(target).startsWith(realpathSync(root) + sep)
    ) {
      findings.push({ path, reason: "unscannable or escaping candidate" });
      continue;
    }
    if (stat.size > 5 * 1024 * 1024) {
      findings.push({ path, reason: "candidate exceeds 5 MiB review limit" });
      continue;
    }
    const bytes = readFileSync(target);
    files.push({
      path,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    if (/\.(png|jpg|jpeg|ico|pdf|pptx|mp4|webm)$/i.test(path)) continue;
    const text = bytes.toString("utf8");
    if (credentialPattern.test(text))
      findings.push({ path, reason: "credential-like content" });
    for (const match of text.matchAll(
      /(?:postgres(?:ql)?|https?):\/\/[^\s/@:"]+:([^\s/@"]+)@/gi,
    ))
      if (
        !(path === "tests/workflow.test.ts" && match[1] === "password") &&
        !/^\$\{[A-Z_][A-Z0-9_]*\}$/.test(match[1])
      )
        findings.push({ path, reason: "credential-bearing URL" });
    if (
      /(?:from\s*["'][^"']*[\\/]Build[\\/]|require\(["'][^"']*[\\/]Build[\\/]|file:[^\s"']*[\\/]Build[\\/])/.test(
        text,
      )
    )
      findings.push({ path, reason: "private implementation dependency" });
  }
  return {
    result: findings.length ? ("fail" as const) : ("pass" as const),
    trackedCount: tracked.length,
    candidateCount: candidates.length,
    untrackedCount: candidates.length - tracked.length,
    scope:
      "Tracked and nonignored untracked candidates; ignored private configuration/runtime state is not read. Binary files are hashed, not credential-scanned; pattern scanning is not exhaustive secret detection.",
    findings,
    files,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const report = reviewPublic(process.cwd());
  if (process.argv.includes("--json")) console.log(JSON.stringify(report));
  else
    console.log(
      `${report.result.toUpperCase()} public-source review: ${report.trackedCount} tracked, ${report.untrackedCount} untracked, ${report.candidateCount} candidates; ${report.findings.length} findings.`,
    );
  if (report.findings.length) {
    for (const finding of report.findings)
      console.error(`${finding.path}: ${finding.reason}`);
    process.exitCode = 1;
  }
}
