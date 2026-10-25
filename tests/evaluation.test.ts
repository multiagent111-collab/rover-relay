import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { reviewPublic } from "../scripts/public-review.ts";
import { NightshiftGenerator, type AgentInput } from "../src/agents.ts";
import { acceptanceMatrix, publicGate } from "../scripts/evaluation/matrix.ts";

test("evaluation cannot pass missing, skipped, failed or unknown matrix evidence", () => {
  const empty = acceptanceMatrix([], { clean: true, provenance: true });
  assert.equal(empty.length, 24);
  assert.equal(publicGate(empty, true), "fail");
  const names = empty.flatMap((row) => row.evidence.map((e) => e.name));
  const passing = names.map((name) => ({ name, result: "pass" }));
  const complete = acceptanceMatrix(passing, { clean: true, provenance: true });
  assert.equal(publicGate(complete, true), "pass");
  assert.equal(complete.filter((r) => r.result === "deferred").length, 3);
  for (const result of ["fail", "skipped"]) {
    const observations = [...passing];
    observations[0] = { ...observations[0], result };
    assert.equal(
      publicGate(
        acceptanceMatrix(observations, { clean: true, provenance: true }),
        true,
      ),
      "fail",
    );
  }
  assert.equal(publicGate(complete, false), "fail");
  assert.equal(
    publicGate(
      acceptanceMatrix(passing, { clean: false, provenance: true }),
      true,
    ),
    "fail",
  );
  assert.equal(
    publicGate(
      acceptanceMatrix(passing, { clean: true, provenance: false }),
      true,
    ),
    "fail",
  );
  assert.equal(
    publicGate(
      acceptanceMatrix([{ name: "unrelated green test", result: "pass" }], {
        clean: true,
        provenance: true,
      }),
      true,
    ),
    "fail",
  );
});

test("public review catches new untracked credentials and private dependencies while ignoring runtime configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-public-review-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: directory, stdio: "pipe" });
  try {
    git("init", "--quiet");
    await writeFile(join(directory, ".gitignore"), ".env\n.data/\n");
    await writeFile(join(directory, "safe.ts"), "export const safe = true;\n");
    git("add", "--", "safe.ts", ".gitignore");
    await writeFile(
      join(directory, ".env"),
      "NVIDIA_API_KEY=" + "nvapi-" + "x".repeat(24),
    );
    await mkdir(join(directory, ".data"));
    await writeFile(
      join(directory, ".data", "private.json"),
      "private fixture",
    );
    assert.equal(reviewPublic(directory).result, "pass");
    await writeFile(
      join(directory, "new.ts"),
      'export const unsafe = "' + "nvapi-" + "x".repeat(24) + '";',
    );
    let report = reviewPublic(directory);
    assert.equal(report.result, "fail");
    assert.equal(report.untrackedCount, 1);
    assert.ok(
      report.findings.some(
        (f) => f.path === "new.ts" && f.reason === "credential-like content",
      ),
    );
    await writeFile(
      join(directory, "new.ts"),
      'import x from "../' + "Build" + '/private.ts";',
    );
    report = reviewPublic(directory);
    assert.ok(
      report.findings.some(
        (f) => f.reason === "private implementation dependency",
      ),
    );
    await writeFile(join(directory, "new.ts"), "export const reviewed = true;");
    assert.equal(reviewPublic(directory).result, "pass");
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), "relay-public-review-")));
    await rm(directory, { recursive: true, force: true });
  }
});

test("evaluation fault set: TLS failure, rate limit, authentication and timeout reject without fallback", async () => {
  const previousFetch = globalThis.fetch;
  const names = [
    "METERLESS_BASE_URL",
    "METERLESS_RUNTIME_TOKEN",
    "METERLESS_ROUTE",
  ];
  const previous = names.map((name) => process.env[name]);
  Object.assign(process.env, {
    METERLESS_BASE_URL: "http://evaluation.invalid",
    METERLESS_RUNTIME_TOKEN: "non-secret-fixture-token",
    METERLESS_ROUTE: "meterless/auto",
  });
  const input: AgentInput = {
    request: {
      sku: "HDMI-USB-C",
      quantity: 2,
      destination: "auditorium",
      budgetCents: 3500,
      deadlineMinutes: 30,
    },
    candidates: [],
    memory: {
      records: [],
      context: "",
      entrance: null,
      revision: "",
      engine: "controlled",
    },
    round: 1,
    feedback: [],
  };
  try {
    for (const kind of ["tls", "rate_limit", "authentication", "timeout"]) {
      let attempts = 0;
      globalThis.fetch = async (_url, options) => {
        attempts++;
        if (kind === "tls")
          throw Object.assign(new Error("Controlled TLS fault"), {
            code: "CERT_HAS_EXPIRED",
          });
        if (kind === "rate_limit")
          return new Response("hidden upstream body", { status: 429 });
        if (kind === "authentication")
          return new Response("hidden upstream body", { status: 401 });
        return new Promise((_resolve, reject) => {
          const signal = options!.signal!;
          if (signal.aborted) reject(signal.reason);
          else
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
        });
      };
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 20);
      const expected =
        kind === "authentication"
          ? "nightshift_unauthorized"
          : kind === "rate_limit"
            ? "nightshift_rate_limited"
            : "nightshift_unavailable";
      await assert.rejects(
        () =>
          new NightshiftGenerator().generate(
            "Planner",
            input,
            controller.signal,
          ),
        (e: { code: string; message: string }) =>
          e.code === expected && !e.message.includes("hidden upstream"),
      );
      clearTimeout(timer);
      assert.equal(attempts, 1, "no retry or provider fallback");
    }
  } finally {
    globalThis.fetch = previousFetch;
    names.forEach((name, i) => {
      if (previous[i] === undefined) delete process.env[name];
      else process.env[name] = previous[i];
    });
  }
});
