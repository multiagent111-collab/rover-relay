import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"]).toString("utf8").split("\0").filter(Boolean);
const findings = [];
for (const file of files) {
  if (/(^|\/)(node_modules|dist|\.data)\//.test(file) || /\.sqlite(?:[.-].*)?$/.test(file) ||
    (/(^|\/)\.env(?:\.|$)/.test(file) && file !== ".env.example") ||
    /(^|\/)\.npmrc$|\.(pem|p12|pfx)$/.test(file)) findings.push(`${file}: excluded runtime/configuration file`);
  if (/\.(png|jpg|jpeg|ico)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  const secret = /(?:nvapi-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|dckr_pat_[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
  if (secret.test(text)) findings.push(`${file}: credential-like content`);
}
if (findings.length) { console.error(findings.join("\n")); process.exitCode = 1; }
else console.log(`PASS public-source check: ${files.length} tracked files, no excluded paths or recognized credential formats.`);
