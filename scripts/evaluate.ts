import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
  realpath,
  stat,
} from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative, sep } from "node:path";
import { reviewPublic, credentialPattern } from "./public-review.ts";
import {
  acceptanceMatrix,
  publicGate,
  type Observation,
} from "./evaluation/matrix.ts";

type Phase = {
  name: string;
  mode: string;
  startedAt: string;
  durationMs: number;
  result: "pass" | "fail";
  exitCode: number | null;
  timedOut: boolean;
  tests: Observation[];
  records: Record<string, unknown>[];
};
const root = process.cwd(),
  args = process.argv.slice(2);
if (
  args.some(
    (a) =>
      a !== "--live" &&
      a !== "--accept-routed-nemotron" &&
      !a.startsWith("--output="),
  ) ||
  args.filter((a) => a.startsWith("--output=")).length > 1 ||
  (args.includes("--accept-routed-nemotron") && !args.includes("--live"))
) {
  console.error(
    "Usage: npm run evaluate -- [--live --accept-routed-nemotron] [--output=new-report.json]",
  );
  process.exit(2);
}
const output = resolve(
  args.find((a) => a.startsWith("--output="))?.slice(9) ||
    join(
      ".data",
      "evaluations",
      `relay-11-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}.json`,
    ),
);
if (
  !output.startsWith(root + sep) ||
  !output.endsWith(".json") ||
  existsSync(output) ||
  relative(root, output)
    .split(sep)
    .some((p) => p.startsWith(".env"))
) {
  console.error(
    "Choose a new .json report inside this repository; no report/configuration is overwritten.",
  );
  process.exit(2);
}
await mkdir(dirname(output), { recursive: true });
if (
  (await realpath(dirname(output))) !== (await realpath(root)) &&
  !(await realpath(dirname(output))).startsWith((await realpath(root)) + sep)
) {
  console.error("Report directory must remain inside this repository.");
  process.exit(2);
}
const runId = randomUUID(),
  startedAt = new Date().toISOString(),
  phases: Phase[] = [];
async function run(
  name: string,
  mode: string,
  command: string,
  argv: string[],
  cwd = root,
  env = process.env,
  timeoutMs = 240000,
): Promise<Phase> {
  console.log(`Evaluating ${name} (${mode})...`);
  const start = performance.now(),
    at = new Date().toISOString();
  const result = await new Promise<{
    code: number | null;
    timedOut: boolean;
    stdout: string;
  }>((done) => {
    const child = spawn(command, argv, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      timedOut = false;
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 4 * 1024 * 1024) stdout += chunk.toString();
    });
    child.stderr.resume(); // diagnostics may contain URLs/tokens; never persist them
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      done({ code: null, timedOut, stdout });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      done({ code, timedOut, stdout });
    });
  });
  const records: Record<string, unknown>[] = [];
  for (const line of result.stdout.split(/\r?\n/))
    try {
      const parsed = JSON.parse(line);
      if (
        parsed &&
        typeof parsed === "object" &&
        !credentialPattern.test(JSON.stringify(parsed))
      ) {
        if (
          ["test", "summary", "proof", "measured_sample"].includes(parsed.kind)
        )
          records.push(parsed);
        else if (parsed.postgresql && parsed.docker)
          records.push({
            kind: "postgres_versions",
            node: parsed.node,
            postgresql: parsed.postgresql,
            docker: parsed.docker,
            image: parsed.image,
            imageId: parsed.imageId,
            storage: parsed.storage,
          });
      }
    } catch {}
  const phase: Phase = {
    name,
    mode,
    startedAt: at,
    durationMs: Math.round(performance.now() - start),
    result: result.code === 0 && !result.timedOut ? "pass" : "fail",
    exitCode: result.code,
    timedOut: result.timedOut,
    tests: records.filter((r) => r.kind === "test") as unknown as Observation[],
    records: records.filter((r) => r.kind !== "test"),
  };
  phases.push(phase);
  console.log(
    `${phase.result.toUpperCase()} ${name}: ${phase.durationMs} ms; ${phase.tests.length} reported tests`,
  );
  return phase;
}
const node = (
  name: string,
  mode: string,
  argv: string[],
  cwd = root,
  env = process.env,
) => run(name, mode, process.execPath, argv, cwd, env);
const npm = (name: string, argv: string[], cwd: string) =>
  process.platform === "win32"
    ? run(
        name,
        cwd === root ? "public_working_tree" : "clean_source",
        process.env.ComSpec || "cmd.exe",
        ["/d", "/s", "/c", "npm.cmd", ...argv],
        cwd,
      )
    : run(
        name,
        cwd === root ? "public_working_tree" : "clean_source",
        "npm",
        argv,
        cwd,
      );
const git = (...argv: string[]) =>
  execFileSync("git", argv, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).trimEnd();
const baselineTag = "rover-relay-pre-event-2026-10-21",
  baselineCommit = "1b19c528d639134691289d9c0db38d82e9f277ff";
const baselineMatches =
  git("rev-parse", `${baselineTag}^{commit}`) === baselineCommit;
if (!baselineMatches)
  throw Error(
    "Protected baseline differs; evaluation stopped before tests/live calls.",
  );
const source = reviewPublic(root);
const report: Record<string, unknown> = {
  schemaVersion: "evaluation-1.0",
  resultScope:
    "Public Relay functional gates only; A21-A23 private ROVER remain deferred.",
  ticket: "RELAY-11",
  runId,
  startedAt,
  source: {
    head: git("rev-parse", "HEAD"),
    branch: git("branch", "--show-current"),
    baselineTag,
    baselineCommit,
    workingTree: git("status", "--short").split("\n").filter(Boolean),
    baselineToHead: git("diff", "--shortstat", baselineTag, "HEAD"),
    commits: git("log", "--format=%H %s", `${baselineTag}..HEAD`).split("\n"),
    candidateManifest: source.files,
  },
  provenancePolicy:
    "Tagged baseline is prior work. Post-opening commits include disclosed inherited integration hunks; dates/digests alone do not establish authorship. See DEVELOPMENT_LOG and PRIOR_WORK. No Cursor work is claimed for Codex tickets.",
  versions: {
    node: process.version,
    dependencies: JSON.parse(await readFile("package.json", "utf8"))
      .dependencies,
    hmemRevision: "1742dec56a66e58eef9dda2d2b865823758ca8cd",
  },
  seed: "Public seedFixtures v1; fixed scenario order. UUIDs/store identities/ports are random. Business clocks are controlled only in labeled sample cases.",
  sourceReview: source,
  phases,
  privateRover: {
    result: "deferred_by_user",
    tested: false,
    realJobsCreated: 0,
    privateSourceRead: false,
  },
  measurementPolicy:
    "Functional checks only; no reliability percentage. Phase wall time includes setup/cleanup. Controlled duration is never pooled with actual sponsor latency. Regression-wide generator totals are uninstrumented, not inferred from test count; measured scenarios and live HTTP counts are reported separately.",
  historicalEvidence: [
    {
      path: "examples/recorded/relay-02-federation-2026-10-22.json",
      scope:
        "Prior actual independent-source mutation/restoration; not rerun by this evaluation.",
    },
    {
      path: "examples/recorded/relay-09-browser-2026-10-22.json",
      scope:
        "Prior actual browser interactions/screenshots; current automated tests cover components and real PostgreSQL. New live browser observations must be labeled separately.",
    },
  ],
};
const temporary = await mkdtemp(join(tmpdir(), "relay-evaluation-"));
let live: Record<string, unknown> = {
  result: "not_requested",
  scope:
    "No hosted sponsor call unless --live is explicit. Historical artifacts do not count as a current run.",
};
try {
  const tests = readdirSync("tests")
    .filter((f) => /\.test\.tsx?$/.test(f))
    .sort()
    .map((f) => `tests/${f}`);
  const controlled = await node(
    "regressions",
    "controlled_adapters_SQLite_HMEM",
    [
      "--import",
      "tsx",
      "--test",
      "--test-reporter=./scripts/evaluation/reporter.mjs",
      ...tests,
    ],
  );
  const measured = await node(
    "measured sample scenarios",
    "offline_sample_simulator",
    ["--import", "tsx", "scripts/evaluation/sample.ts"],
  );
  const postgres = await node(
    "PostgreSQL races and recovery",
    "actual_isolated_PostgreSQL_simulated_operations",
    ["--import", "tsx", "scripts/postgres.ts", "--report=json"],
  );
  const hmem = await node(
    "official H-MEM integrity/conformance",
    "actual_official_engine",
    ["scripts/verify-hmem.mjs"],
  );
  const baseline = await node(
    "protected baseline inventory",
    "public_provenance",
    ["scripts/baseline-manifest.mjs"],
  );
  const build = await npm("production build", ["run", "build"], root);
  const clean = join(temporary, "clean");
  await mkdir(clean);
  if (source.result === "pass")
    for (const file of source.files) {
      // Exclude prior recorded artifacts from the clean working source export;
      // all code/config placeholders/vendor/lockfiles remain present.
      if (file.path.startsWith("examples/recorded/")) continue;
      const target = resolve(clean, file.path);
      if (!target.startsWith(clean + sep)) throw Error("Escaping clean export");
      await mkdir(dirname(target), { recursive: true });
      await copyFile(resolve(root, file.path), target);
    }
  let cleanPass = false;
  if (source.result === "pass") {
    const installed = await npm(
      "independent locked install",
      ["ci", "--offline", "--ignore-scripts"],
      clean,
    );
    if (installed.result === "pass") {
      const built = await npm(
        "independent production build",
        ["run", "build"],
        clean,
      );
      const sample = await node(
        "independent measured sample",
        "clean_source_offline_sample",
        ["--import", "tsx", "scripts/evaluation/sample.ts"],
        clean,
      );
      cleanPass =
        built.result === "pass" &&
        sample.result === "pass" &&
        sample.records.some(
          (r) => r.kind === "measured_sample" && r.result === "pass",
        );
    }
  }
  if (args.includes("--live")) {
    const artifact = join(temporary, "actual-sponsor.json"),
      metrics = join(temporary, "actual-counts.json");
    const phase = await node(
      "selected Nightshift/Zetaris mission",
      "actual_sponsor_transport_no_dispatch",
      [
        "--import",
        "tsx",
        "--import",
        "./scripts/evaluation/fetch-metrics.mjs",
        "scripts/nightshift.ts",
        "--live",
        ...(args.includes("--accept-routed-nemotron")
          ? ["--accept-routed-nemotron"]
          : []),
        `--output=${artifact}`,
      ],
      root,
      { ...process.env, RELAY_EVALUATION_METRICS: metrics },
    );
    const outcome = existsSync(artifact)
      ? JSON.parse(await readFile(artifact, "utf8"))
      : { result: "fail", errorCode: "live_verifier_no_report" };
    const counts = existsSync(metrics)
      ? JSON.parse(await readFile(metrics, "utf8"))
      : { totalCalls: null, inferenceCalls: null };
    live = {
      result:
        phase.result === "pass" && outcome.result === "pass" ? "pass" : "fail",
      scope:
        "One bounded actual Nightshift/Zetaris planning mission using isolated confirmed H-MEM. No dispatch approval/job, no source mutation, no retry/fallback or running configuration change. Synthetic campus business data via actual sponsor transports.",
      sourceVerifier:
        "scripts/nightshift.ts (implemented in RELAY-05, executed now for RELAY-11)",
      observed: outcome,
      http: counts,
    };
  }
  const observations = [...controlled.tests, ...postgres.tests];
  const matrix = acceptanceMatrix(observations, {
    clean: cleanPass && hmem.result === "pass",
    provenance:
      baselineMatches && baseline.result === "pass" && source.result === "pass",
  });
  const publicResult = publicGate(
    matrix,
    controlled.result === "pass" &&
      postgres.result === "pass" &&
      measured.result === "pass" &&
      build.result === "pass",
  );
  report.matrix = matrix;
  report.liveSponsors = live;
  report.publicInvariants = publicResult;
  report.result =
    publicResult === "pass" &&
    (!args.includes("--live") || live.result === "pass")
      ? "pass"
      : "fail";
  const endingReview = reviewPublic(root);
  report.sourceUnchangedDuringRun =
    source.files.length === endingReview.files.length &&
    source.files.every((file) =>
      endingReview.files.some(
        (current) =>
          current.path === file.path && current.sha256 === file.sha256,
      ),
    );
  if (!report.sourceUnchangedDuringRun || endingReview.result !== "pass") {
    report.result = "fail";
    report.errorCode = "public_source_changed_during_evaluation";
  }
  report.remainingGates = [
    "A21–A23 private ROVER explicitly deferred; controlled HTTP conformance is not private execution.",
    "Current automated UI checks are component/API tests; full browser evidence is separately dated.",
    "Exact configured Lightning model pinning and independent NVIDIA attestation are not established by Runtime receipt correlation.",
    "Small functional sample; no statistical reliability or real delivery/inventory/payment claim.",
  ];
} catch {
  report.result = "fail";
  report.errorCode = "evaluation_step_failed";
  report.liveSponsors = live;
} finally {
  const actual = await realpath(temporary),
    parent = await realpath(tmpdir());
  if (
    dirname(actual).toLowerCase() !== parent.toLowerCase() ||
    !actual.split(/[\\/]/).at(-1)!.startsWith("relay-evaluation-")
  )
    throw Error("Unsafe evaluation cleanup target");
  try {
    await rm(actual, { recursive: true, force: true });
    report.evaluationTemporaryExportRemoved = true;
  } catch {
    report.evaluationTemporaryExportRemoved = false;
    report.result = "fail";
    report.cleanupError = "temporary_export_retained_for_diagnosis";
  }
  report.completedAt = new Date().toISOString();
}
const text = JSON.stringify(report, null, 2) + "\n";
if (credentialPattern.test(text))
  throw Error("Report failed credential review; no public artifact written.");
await writeFile(output, text, { flag: "wx" });
console.log(
  JSON.stringify({
    result: report.result,
    publicInvariants: report.publicInvariants,
    liveSponsors: live.result,
    deferredPrivateGates: ["A21", "A22", "A23"],
    report: relative(root, output),
    runId,
  }),
);
if (report.result !== "pass") process.exitCode = 1;
