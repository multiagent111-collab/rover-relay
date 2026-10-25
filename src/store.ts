import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import pg from "pg";
import { seedState } from "./fixtures.ts";
import { RelayError, type State, type Store } from "./types.ts";

// A single versioned aggregate keeps this small simulator's mission, task,
// courier reservation and outbox changes atomic. Not a production job schema.
export class SqliteStore implements Store {
  private db: DatabaseSync;
  constructor(filename: string) {
    mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS relay_state (id INTEGER PRIMARY KEY CHECK (id=1), value TEXT NOT NULL)",
    );
    this.db
      .prepare("INSERT OR IGNORE INTO relay_state VALUES (1, ?)")
      .run(JSON.stringify(seedState()));
  }
  async read(): Promise<State> {
    return JSON.parse(
      (
        this.db.prepare("SELECT value FROM relay_state WHERE id=1").get() as {
          value: string;
        }
      ).value,
    );
  }
  async transact<T>(fn: (state: State) => T): Promise<T> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const state: State = JSON.parse(
        (
          this.db.prepare("SELECT value FROM relay_state WHERE id=1").get() as {
            value: string;
          }
        ).value,
      );
      const result = fn(state);
      this.db
        .prepare("UPDATE relay_state SET value=? WHERE id=1")
        .run(JSON.stringify(state));
      this.db.exec("COMMIT");
      return structuredClone(result);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async close() {
    this.db.close();
  }
}

export class PostgresStore implements Store {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: 5,
      connectionTimeoutMillis: 5000,
      lock_timeout: 5000,
      statement_timeout: 10000,
      query_timeout: 15000,
      idle_in_transaction_session_timeout: 10000,
    });
    // pg removes failed idle clients. A later operation reports a safe error;
    // an idle socket failure must not become an unhandled process exception.
    this.pool.on("error", () => {});
  }
  async initialize() {
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS relay_state (id integer PRIMARY KEY CHECK (id=1), value jsonb NOT NULL)",
    );
    await this.pool.query(
      "INSERT INTO relay_state VALUES (1,$1::jsonb) ON CONFLICT DO NOTHING",
      [JSON.stringify(seedState())],
    );
  }
  async read(): Promise<State> {
    try {
      return (await this.pool.query("SELECT value FROM relay_state WHERE id=1"))
        .rows[0].value;
    } catch {
      throw new RelayError(
        503,
        "storage_unavailable",
        "PostgreSQL is unavailable. Retry the original request with the same approval key and terms.",
      );
    }
  }
  async transact<T>(fn: (state: State) => T): Promise<T> {
    const client = await this.pool.connect().catch(() => {
      throw new RelayError(
        503,
        "storage_unavailable",
        "PostgreSQL is unavailable. Retry the original request with the same approval key and terms.",
      );
    });
    let committing = false;
    let discard = false;
    const disconnected = () => {
      discard = true;
    };
    client.on("error", disconnected);
    try {
      await client.query("BEGIN");
      const state: State = (
        await client.query(
          "SELECT value FROM relay_state WHERE id=1 FOR UPDATE",
        )
      ).rows[0].value;
      const result = fn(state);
      await client.query("UPDATE relay_state SET value=$1::jsonb WHERE id=1", [
        JSON.stringify(state),
      ]);
      committing = true;
      await client.query("COMMIT");
      committing = false;
      return structuredClone(result);
    } catch (error) {
      // Never replay a callback: it can allocate IDs and touch H-MEM. After an
      // uncertain COMMIT only the original owner/key/payload may resolve it.
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
      }
      if (error instanceof RelayError) throw error;
      throw new RelayError(
        503,
        committing ? "storage_outcome_unknown" : "storage_unavailable",
        committing
          ? "The commit outcome is unknown. Retry the original approval with the same key and terms."
          : "The transaction could not complete. Retry the original request with the same approval key and terms.",
      );
    } finally {
      client.release(discard);
      client.off("error", disconnected);
    }
  }
  async close() {
    await this.pool.end();
  }
}
