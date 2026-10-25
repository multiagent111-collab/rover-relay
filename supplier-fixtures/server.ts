import Fastify from "fastify";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { seedFixtures } from "../src/fixtures.ts";
import { loadEnvironment } from "../src/config.ts";
import {
  acquireWriterLock,
  assertPortAvailable,
  installLocalControl,
  supplierSettings,
  supplierConfigurationId,
} from "../src/lifecycle.ts";

// Independently persisted source for Zetaris registration. It does not read
// Relay's mission/courier aggregate or call the Relay API.
loadEnvironment();
const settings = supplierSettings();
try {
  await assertPortAvailable(settings.host, settings.port);
} catch {
  console.error(
    "Supplier port is occupied or blocked. Reuse the existing source or select another port.",
  );
  process.exit(1);
}
const path = settings.path;
const lock = acquireWriterLock(settings.directory, ".supplier-writer.lock");
mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path);
db.exec(
  "CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
);
for (const supplier of seedFixtures().suppliers)
  db.prepare("INSERT OR IGNORE INTO inventory VALUES (?, ?)").run(
    supplier.id,
    JSON.stringify(supplier),
  );
const app = Fastify({ logger: false, bodyLimit: 4096 });
app.get("/health", async () => ({
  status: "ok",
  project: "Relay supplier",
  instanceId: lock.instanceId,
  launchId: process.env.RELAY_LOCAL_LAUNCH_ID || null,
  configurationId: supplierConfigurationId(settings),
}));
installLocalControl(app, process.env.RELAY_LOCAL_CONTROL_TOKEN);
app.get("/inventory", async () => ({
  data: (
    db.prepare("SELECT value FROM inventory ORDER BY id").all() as {
      value: string;
    }[]
  ).map((row) => {
    const supplier = JSON.parse(row.value);
    return {
      tenant_id: "relay-demo",
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      sku: supplier.sku,
      stock: supplier.stock,
      unit_price_cents: supplier.unitPriceCents,
      pickup_node: supplier.pickupNode,
      handling_minutes: supplier.handlingMinutes,
      supplier_version: supplier.version,
      observed_at: new Date().toISOString(),
      supplier_source: "relay_supplier_http",
    };
  }),
}));
app.post("/inventory/:id/stock", async (request, reply) => {
  const expected = process.env.SUPPLIER_ADMIN_TOKEN
    ? `Bearer ${process.env.SUPPLIER_ADMIN_TOKEN}`
    : "";
  const received = request.headers.authorization || "";
  if (
    !expected ||
    Buffer.byteLength(expected) !== Buffer.byteLength(received) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  )
    return reply.code(401).send({ error: "unauthorized" });
  const parsed = z
    .object({ stock: z.number().int().min(0).max(100) })
    .strict()
    .safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
  const id = (request.params as { id: string }).id;
  const row = db.prepare("SELECT value FROM inventory WHERE id=?").get(id) as
    { value: string } | undefined;
  if (!row) return reply.code(404).send({ error: "not_found" });
  const supplier = JSON.parse(row.value);
  supplier.stock = parsed.data.stock;
  supplier.version++;
  db.prepare("UPDATE inventory SET value=? WHERE id=?").run(
    JSON.stringify(supplier),
    id,
  );
  return { id, stock: supplier.stock, version: supplier.version };
});
app.addHook("onClose", async () => {
  db.close();
  lock.release();
});
await app.listen({
  host: settings.host,
  port: settings.port,
});
console.log(
  "Independent supplier source listening on port " +
    (process.env.SUPPLIER_PORT || 4174),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
