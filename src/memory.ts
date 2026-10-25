import { HMEM } from "../vendor/hmem/src/index.ts";
import { hash, ownerKey } from "./domain.ts";
import {
  MemoryStorage,
  confirmedEntrance,
  HMEM_REVISION,
} from "./memory-storage.ts";
import { RelayError, type Identity, type MemoryContext } from "./types.ts";
export { HMEM_REVISION } from "./memory-storage.ts";
export class MemoryAdapter {
  private storage: MemoryStorage;
  constructor(
    directory: string,
    private clock = Date.now,
  ) {
    this.storage = new MemoryStorage(directory);
  }
  private run<T>(
    identity: Identity,
    venue: string,
    change: boolean,
    operation: (engine: HMEM, generation: number, storeId: string) => T,
  ) {
    return this.storage.run(
      identity,
      venue,
      change,
      (directory, generation, storeId) => {
        const engine = new HMEM({
          persistDir: directory,
          clock: this.clock,
          actor: "relay-confirmed-preferences",
        });
        const result = operation(engine, generation, storeId);
        engine.store.persist();
        return result;
      },
    );
  }
  private context(
    engine: HMEM,
    identity: Identity,
    venue: string,
    generation: number,
    storeId: string,
  ): MemoryContext {
    const result = engine.query(`Delivery entrance preference for ${venue}`, {
      threshold: 0,
      topN: Math.max(1, engine.store.all().length),
    });
    const recalled = result.memories.filter(({ memory }) =>
      confirmedEntrance(memory),
    );
    const records = recalled.map(({ memory, relevance }) => ({
      id: memory.id,
      content: memory.content,
      relevance,
    }));
    return {
      records,
      context: engine.retrieval.formatReinjection(recalled),
      entrance:
        recalled[0]?.memory.content.slice(
          "Delivery entrance preference: ".length,
        ) ?? null,
      revision: hash({
        storeId,
        owner: ownerKey(identity),
        venue,
        generation,
        sequence: engine.store.snapshotAll().seq,
        records: records.map((r) => [r.id, r.content]).sort(),
      }),
      engine: `Meterless H-MEM reference ${HMEM_REVISION}`,
    };
  }
  recall(identity: Identity, venue: string) {
    return this.run(identity, venue, false, (engine, generation, storeId) =>
      this.context(engine, identity, venue, generation, storeId),
    );
  }
  set(identity: Identity, venue: string, entrance: string) {
    if (
      typeof entrance !== "string" ||
      entrance !== entrance.trim() ||
      entrance.length < 2 ||
      entrance.length > 120
    )
      throw new RelayError(
        400,
        "invalid_preference",
        "Confirm an entrance between 2 and 120 characters.",
      );
    return this.run(identity, venue, true, (engine, generation, storeId) => {
      const old = engine.store.all().filter(confirmedEntrance);
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
      return this.context(engine, identity, venue, generation, storeId);
    });
  }
  forget(identity: Identity, venue: string) {
    return this.run(identity, venue, true, (engine, generation, storeId) => {
      for (const record of engine.store.all().filter(confirmedEntrance))
        engine.store.delete(record.id, "User requested forgetting");
      return this.context(engine, identity, venue, generation, storeId);
    });
  }
  // Private local audit includes deleted IDs. Forgetting removes active
  // influence; earlier receipts, task instructions and audit text remain.
  audit(identity: Identity, venue: string) {
    return this.run(identity, venue, false, (engine) =>
      [...new Set(engine.ledger.all().map((entry) => entry.memoryId))].map(
        (id) => ({ id, history: engine.ledger.history(id) }),
      ),
    );
  }
}
