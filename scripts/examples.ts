import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../src/app.ts";
import { configuration } from "../src/config.ts";
import type { Mission } from "../src/types.ts";

const dataDir = await mkdtemp(join(tmpdir(), "relay-examples-"));
const { app } = await createApp({
  config: {
    ...configuration(),
    sample: true,
    demo: true,
    databaseUrl: "",
    dataDir,
  },
});
const destination = resolve("examples/recorded");
await mkdir(destination, { recursive: true });
const input = {
  sku: "HDMI-USB-C",
  quantity: 2,
  destination: "auditorium",
  budgetCents: 3500,
  deadlineMinutes: 30,
};
try {
  for (const [name, request] of [
    ["feasible", input],
    ["infeasible", { ...input, budgetCents: 3000 }],
  ] as const) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/missions",
      payload: request,
    });
    if (response.statusCode !== 201) throw new Error(response.body);
    const mission = response.json<Mission>();
    await writeFile(
      join(destination, `${name}.json`),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          mode: "offline_sample",
          input: request,
          output: mission,
        },
        null,
        2,
      ) + "\n",
    );
    const events = await app.inject({
      url: `/v1/missions/${mission.id}/evidence.jsonl`,
    });
    await writeFile(join(destination, `${name}.jsonl`), events.body);
  }
  const before = (
    await app.inject({ method: "POST", url: "/v1/missions", payload: input })
  ).json<Mission>();
  await app.inject({
    method: "POST",
    url: "/demo/disruptions",
    payload: { type: "stock", supplierId: "supplier-a", stock: 0 },
  });
  const approval = await app.inject({
    method: "POST",
    url: `/v1/missions/${before.id}/approve`,
    payload: {
      version: before.receipt!.version,
      digest: before.receipt!.digest,
      idempotencyKey: "example-stale-approval",
    },
  });
  const after = (
    await app.inject({ url: `/v1/missions/${before.id}` })
  ).json<Mission>();
  if (approval.statusCode !== 409 || after.receipt!.version !== 2)
    throw new Error("Disruption example failed");
  await writeFile(
    join(destination, "disruption.json"),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        mode: "offline_sample",
        input,
        disruption: "Supplier A stock set to zero",
        staleApprovalResponse: approval.json(),
        before,
        after,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    join(destination, "disruption.jsonl"),
    (await app.inject({ url: `/v1/missions/${before.id}/evidence.jsonl` }))
      .body,
  );
  console.log(`Recorded three actual offline sample runs in ${destination}`);
} finally {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
}
