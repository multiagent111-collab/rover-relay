import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import pg from "pg";
import { seedState } from "./fixtures.ts";
import type { State, Store } from "./types.ts";

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
    });
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
    return (await this.pool.query("SELECT value FROM relay_state WHERE id=1"))
      .rows[0].value;
  }
  async transact<T>(fn: (state: State) => T): Promise<T> {
    const client = await this.pool.connect();
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
      await client.query("COMMIT");
      return structuredClone(result);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
}
