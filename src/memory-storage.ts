import {
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { RelayError, type Identity } from "./types.ts";
import { ownerKey } from "./domain.ts";
export const HMEM_REVISION = "1742dec56a66e58eef9dda2d2b865823758ca8cd";
const text = z.string().max(8192),
  short = z.string().max(200),
  recordId = z.string().regex(/^mem-[1-9]\d*$/),
  finite = z.number().finite();
const recordSchema = z
  .object({
    id: recordId,
    content: text,
    type: z.enum(["personal", "factual", "preference", "general"]),
    layer: z.enum(["short_term", "working", "long_term"]),
    timestamp: finite,
    lastAccessed: finite,
    accessCount: z.number().int().min(0),
    tags: z.array(short).max(64),
    embedding: z.array(finite).length(64),
    score: finite.optional(),
    confidence: finite.min(0).max(1),
    source: short.min(1),
    provenance: z
      .object({
        origin: z.enum([
          "chat_message",
          "user_correction",
          "file_save",
          "file_open",
          "file_edit",
          "model_response",
          "plan_completion",
          "document",
          "manual",
          "dream",
          "sleep_synthesis",
        ]),
        learnedAt: finite,
        label: short,
        refs: z.array(short).max(100).optional(),
      })
      .strict(),
    chatId: short.optional(),
    missionId: short.optional(),
    goalRunId: short.optional(),
    domain: short,
    namespace: short,
    entities: z.array(short).max(10),
    relatedTo: z.array(recordId).max(5),
    supersedes: recordId.optional(),
    supersededBy: recordId.optional(),
    derivedFrom: z.array(recordId).max(100).optional(),
  })
  .strict();
const snapshot = recordSchema.omit({ embedding: true });
const stateSchema = z
  .object({
    seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    records: z.array(recordSchema).max(1000),
  })
  .strict();
// Relay's adapter uses these three vendor operations. Other engine workflows
// require an explicit migration/review before their files can be adopted here.
const entrySchema = z
  .object({
    memoryId: recordId,
    action: z.enum(["create", "read", "delete"]),
    actor: short.min(1),
    timestamp: finite,
    previousState: snapshot.optional(),
    newState: snapshot.optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const digestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .nullable();
const checkpointSchema = z
  .object({
    schemaVersion: z.literal("relay-memory-1.0"),
    engineRevision: z.literal(HMEM_REVISION),
    generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    stateHash: digestSchema,
    ledgerHash: digestSchema,
  })
  .strict();
type Checkpoint = z.infer<typeof checkpointSchema>;
type RecordShape = z.infer<typeof recordSchema>;
export const memoryFailure = () =>
  new RelayError(
    503,
    "memory_unavailable",
    "Confirmed memory could not be verified. Planning and new approval are blocked for this venue. Preserve the files, stop the owning process, and inspect or restore a consistent private backup before restarting. No reset was attempted.",
  );
const digest = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
function stat(path: string) {
  try {
    const s = lstatSync(path);
    if (s.isSymbolicLink()) throw memoryFailure();
    return s;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
function bytes(path: string, limit: number) {
  const s = stat(path);
  if (!s) return null;
  if (!s.isFile() || s.size > limit) throw memoryFailure();
  return readFileSync(path);
}
export function confirmedEntrance(
  record: Pick<RecordShape, "source" | "type" | "tags">,
) {
  return (
    record.source === "user_confirmed" &&
    record.type === "preference" &&
    record.tags.includes("entrance")
  );
}
function stable(record: RecordShape | z.infer<typeof snapshot>) {
  return JSON.stringify([
    record.id,
    record.content,
    record.type,
    record.layer,
    record.tags,
    record.confidence,
    record.source,
    record.provenance,
    record.supersedes ?? null,
  ]);
}
// Validate BEFORE opening H-MEM. Missing halves must not become empty stores.
function inspectPair(directory: string, venue: string) {
  const stateBytes = bytes(join(directory, "state.json"), 2 * 1024 * 1024),
    ledgerBytes = bytes(join(directory, "ledger.jsonl"), 8 * 1024 * 1024);
  if (!stateBytes) throw memoryFailure();
  const state = stateSchema.parse(JSON.parse(stateBytes.toString("utf8")));
  const entries = ledgerBytes
    ? ledgerBytes
        .toString("utf8")
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => entrySchema.parse(JSON.parse(line)))
    : [];
  if (ledgerBytes?.length && !ledgerBytes.toString("utf8").endsWith("\n"))
    throw memoryFailure();
  const active = new Map<string, z.infer<typeof snapshot>>(),
    reads = new Map<string, number>();
  let sequence = 0;
  for (const entry of entries) {
    if (entry.action === "create") {
      if (
        entry.memoryId !== `mem-${++sequence}` ||
        !entry.newState ||
        entry.newState.id !== entry.memoryId ||
        active.has(entry.memoryId)
      )
        throw memoryFailure();
      active.set(entry.memoryId, entry.newState);
      reads.set(entry.memoryId, 0);
    } else {
      const previous = active.get(entry.memoryId);
      if (!previous) throw memoryFailure();
      if (entry.action === "delete") {
        if (
          !entry.previousState ||
          stable(previous) !== stable(entry.previousState)
        )
          throw memoryFailure();
        active.delete(entry.memoryId);
        reads.delete(entry.memoryId);
      } else reads.set(entry.memoryId, (reads.get(entry.memoryId) ?? 0) + 1);
    }
  }
  if (
    state.seq !== sequence ||
    state.records.length !== active.size ||
    new Set(state.records.map((r) => r.id)).size !== state.records.length
  )
    throw memoryFailure();
  for (const record of state.records) {
    const created = active.get(record.id);
    if (
      !created ||
      stable(record) !== stable(created) ||
      record.accessCount !== reads.get(record.id)
    )
      throw memoryFailure();
    if (confirmedEntrance(record)) {
      const entrance = record.content.slice(
        "Delivery entrance preference: ".length,
      );
      if (
        !record.content.startsWith("Delivery entrance preference: ") ||
        entrance.trim() !== entrance ||
        entrance.length < 2 ||
        entrance.length > 120 ||
        record.layer !== "long_term" ||
        record.confidence !== 1 ||
        !record.tags.includes(venue) ||
        record.provenance.origin !== "user_correction"
      )
        throw memoryFailure();
    }
  }
  if (state.records.filter(confirmedEntrance).length > 1) throw memoryFailure();
  return {
    stateHash: digest(stateBytes),
    ledgerHash: ledgerBytes ? digest(ledgerBytes) : null,
  };
}
export class MemoryStorage {
  private blocked = new Set<string>();
  constructor(private root: string) {}
  scope(identity: Identity, venue: string) {
    if (
      !["auditorium", "library"].includes(venue) ||
      typeof identity.tenant !== "string" ||
      typeof identity.user !== "string" ||
      !identity.tenant ||
      !identity.user ||
      identity.tenant.length > 200 ||
      identity.user.length > 200
    )
      throw new RelayError(
        400,
        "invalid_memory_scope",
        "Use a supported venue and authenticated identity.",
      );
    const owner = join(resolve(this.root), ownerKey(identity));
    return { owner, directory: join(owner, venue) };
  }
  run<T>(
    identity: Identity,
    venue: string,
    changesPreference: boolean,
    operation: (directory: string, generation: number, storeId: string) => T,
  ): T {
    const { owner, directory } = this.scope(identity, venue);
    if (this.blocked.has(directory)) throw memoryFailure();
    try {
      for (const path of [resolve(this.root), owner, directory]) {
        const s = stat(path);
        if (s && !s.isDirectory()) throw memoryFailure();
      }
      const existing = stat(directory);
      if (
        stat(resolve(this.root)) &&
        readdirSync(this.root).some((name) =>
          /^\.relay-scopes-.*\.tmp$/.test(name),
        )
      )
        throw memoryFailure();
      if (
        existing &&
        readdirSync(directory).some((name) =>
          /^\.relay-memory-.*\.tmp$/.test(name),
        )
      )
        throw memoryFailure();
      const markerBytes = bytes(join(directory, "relay-memory.json"), 4096);
      let previous: Checkpoint | undefined;
      if (markerBytes) {
        previous = checkpointSchema.parse(
          JSON.parse(markerBytes.toString("utf8")),
        );
        const actual = inspectPair(directory, venue);
        if (
          previous.stateHash !== actual.stateHash ||
          previous.ledgerHash !== actual.ledgerHash
        )
          throw memoryFailure();
      } else if (existing) inspectPair(directory, venue);
      const scopeFile = join(this.root, "relay-scopes.json"),
        scopeBytes = bytes(scopeFile, 128 * 1024);
      const scopes = scopeBytes
        ? z
            .object({
              schemaVersion: z.literal("relay-memory-scopes-1.0"),
              storeId: z.string().uuid(),
              scopes: z
                .array(
                  z.string().regex(/^[a-f0-9]{64}\/(?:auditorium|library)$/),
                )
                .max(1000),
            })
            .strict()
            .parse(JSON.parse(scopeBytes.toString("utf8")))
        : {
            schemaVersion: "relay-memory-scopes-1.0",
            storeId: randomUUID(),
            scopes: [] as string[],
          };
      const key = `${ownerKey(identity)}/${venue}`,
        known = scopes.scopes.includes(key);
      if ((known && (!existing || !markerBytes)) || (!known && markerBytes))
        throw memoryFailure();
      if (!known) {
        scopes.scopes.push(key);
        if (scopes.scopes.length > 1000) throw memoryFailure();
        mkdirSync(this.root, { recursive: true });
        const pending = join(this.root, `.relay-scopes-${randomUUID()}.tmp`);
        writeFileSync(pending, JSON.stringify(scopes) + "\n", {
          flag: "wx",
          mode: 0o600,
        });
        renameSync(pending, scopeFile);
      }
      const generation =
        (previous?.generation ?? 0) + (changesPreference ? 1 : 0);
      if (!Number.isSafeInteger(generation)) throw memoryFailure();
      const result = operation(directory, generation, scopes.storeId),
        actual = inspectPair(directory, venue);
      const checkpoint: Checkpoint = {
        schemaVersion: "relay-memory-1.0",
        engineRevision: HMEM_REVISION,
        generation,
        ...actual,
      };
      const temp = join(directory, `.relay-memory-${randomUUID()}.tmp`);
      writeFileSync(temp, JSON.stringify(checkpoint) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temp, join(directory, "relay-memory.json"));
      return result;
    } catch {
      // No repair, truncation, deletion or cached preference fallback. Partial
      // writes remain private recovery evidence; restart is required to retry.
      this.blocked.add(directory);
      throw memoryFailure();
    }
  }
}
