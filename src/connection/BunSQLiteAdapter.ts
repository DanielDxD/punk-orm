import { Database } from "bun:sqlite";
import type { DatabaseDialect, IDatabaseAdapter } from "./DatabaseAdapter.ts";

/**
 * Bun SQLite adapter using the native `bun:sqlite` module.
 *
 * @example
 * // In-memory database
 * const db = new BunSQLiteAdapter(":memory:");
 *
 * // File-based database
 * const db = new BunSQLiteAdapter("./myapp.db");
 */
export class BunSQLiteAdapter implements IDatabaseAdapter {
    public readonly dialect: DatabaseDialect = "sqlite";
    private db: Database;

    public constructor(filePath: string = ":memory:") {
        this.db = new Database(filePath);
        // Enable WAL mode for better concurrent read performance
        this.db.exec("PRAGMA journal_mode = WAL;");
        this.db.exec("PRAGMA foreign_keys = ON;");
    }

    public async run(sql: string, params: Array<unknown> = []): Promise<void> {
        this.db.prepare(sql).run(...(params as Array<any>));
    }

    public async query<T = Record<string, unknown>>(
        sql: string,
        params: Array<unknown> = []
    ): Promise<Array<T>> {
        return this.db.prepare(sql).all(...(params as Array<any>)) as Array<T>;
    }

    public async transaction(fn: () => Promise<void>): Promise<void> {
        this.db.exec("BEGIN TRANSACTION");
        try {
            await fn();
            this.db.exec("COMMIT");
        } catch (err) {
            this.db.exec("ROLLBACK");
            throw err;
        }
    }

    public close(): void {
        this.db.close();
    }

    /** Expose the raw Database instance for advanced use */
    public get raw(): Database {
        return this.db;
    }
}
