import { join } from "node:path";
import { HMEM } from "../vendor/hmem/src/index.ts";
import { hash, ownerKey } from "./domain.ts";
import type { Identity, MemoryContext } from "./types.ts";

export const HMEM_REVISION = "1742dec56a66e58eef9dda2d2b865823758ca8cd";
export class MemoryAdapter {
  constructor(
    private directory: string,
    private clock = Date.now,
  ) {}
  private engine(identity: Identity, venue: string) {
    return new HMEM({
      persistDir: join(this.directory, ownerKey(identity), venue),
      clock: this.clock,
      actor: "relay-confirmed-preferences",
    });
  }
  recall(identity: Identity, venue: string): MemoryContext {
    const engine = this.engine(identity, venue);
    const result = engine.query(`Delivery entrance preference for ${venue}`, {
      threshold: 0,
      topN: 5,
    });
    engine.store.persist();
    const records = result.memories.map(({ memory, relevance }) => ({
      id: memory.id,
      content: memory.content,
      relevance,
    }));
    const preference = result.memories.find(({ memory }) =>
      memory.tags.includes("entrance"),
    )?.memory;
    return {
      records,
      context: result.context,
      entrance:
        preference?.content.replace(/^Delivery entrance preference: /, "") ??
        null,
      revision: hash(
        records.map((record) => [record.id, record.content]).sort(),
      ),
      engine: `Meterless H-MEM reference ${HMEM_REVISION}`,
    };
  }
  set(identity: Identity, venue: string, entrance: string) {
    const engine = this.engine(identity, venue);
    const old = engine.store
      .all()
      .filter((record) => record.tags.includes("entrance"));
    // Explicitly remove superseded records from retrieval; H-MEM's default
    // supersession penalty alone does not exclude an obsolete preference.
    for (const record of old)
      engine.store.delete(record.id, "Superseded by user-confirmed entrance");
    engine.add({
      content: `Delivery entrance preference: ${entrance}`,
      type: "preference",
      layer: "long_term",
      source: "user_confirmed",
      tags: ["entrance", venue],
      confidence: 1,
      supersedes: old[0]?.id,
      provenance: {
        origin: "user_correction",
        learnedAt: this.clock(),
        label: "Explicit entrance confirmation",
      },
    });
    return this.recall(identity, venue);
  }
  forget(identity: Identity, venue: string) {
    const engine = this.engine(identity, venue);
    for (const record of engine.store.all())
      engine.store.delete(record.id, "User requested forgetting");
    return this.recall(identity, venue);
  }
  audit(identity: Identity, venue: string) {
    const engine = this.engine(identity, venue);
    return engine.store
      .all()
      .map((record) => ({
        id: record.id,
        history: engine.ledger.history(record.id),
      }));
  }
}
