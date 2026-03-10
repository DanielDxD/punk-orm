import * as path from "path";
import type { IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";
import { Logger } from "../utils/logger.ts";
import type { Migration } from "./Migration.ts";

interface MigrationRecord {
    id: number;
    name: string;
    ran_at: string;
}

interface MigrationModule {
    default?: new () => Migration;
    [key: string]: unknown;
}

/** Extract migration class name from a file path like `20260309_181300_create_users.ts` */
export function classNameFromFile(filePath: string): string {
    const base = path.basename(filePath, ".ts");
    // Remove timestamp prefix: YYYYMMDD_HHMMSS_name → name
    const parts = base.split("_");
    const nameParts = parts.length > 2 ? parts.slice(2) : parts;
    return nameParts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

/**
 * Manages migration lifecycle: tracking, running, rolling back.
 *
 * Maintains a `_punk_migrations` table in the database.
 */
export class MigrationManager {
    public constructor(private readonly db: IDatabaseAdapter) {}

    // ── Bootstrap ──────────────────────────────────────────────────────────────

    public async ensureTable(): Promise<void> {
        await this.db.run(`
      CREATE TABLE IF NOT EXISTS _punk_migrations (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        name    TEXT    UNIQUE NOT NULL,
        ran_at  TEXT    NOT NULL
      )
    `);
    }

    // ── Introspection ──────────────────────────────────────────────────────────

    public async getExecuted(): Promise<Array<MigrationRecord>> {
        await this.ensureTable();
        return this.db.query<MigrationRecord>(
            "SELECT id, name, ran_at FROM _punk_migrations ORDER BY id ASC"
        );
    }

    public async getPending(migrationsDir: string): Promise<Array<string>> {
        const all = await this.getMigrationFiles(migrationsDir);
        const executed = new Set((await this.getExecuted()).map((r) => r.name));
        return all.filter((f) => !executed.has(path.basename(f, ".ts")));
    }

    // ── Run ────────────────────────────────────────────────────────────────────

    /** Run all pending migrations in chronological order. Returns applied names. */
    public async runAll(migrationsDir: string): Promise<Array<string>> {
        const pending = await this.getPending(migrationsDir);
        if (pending.length === 0) {
            Logger.success("All migrations are up to date.", "Migrations");
            return [];
        }

        const applied: Array<string> = [];
        for (const filePath of pending) {
            const name = path.basename(filePath, ".ts");
            const migration = await this.loadMigration(filePath);
            Logger.info(`Running: ${name}`, "Migrations");
            await this.db.transaction(async () => {
                await migration.up(this.db);
                await this.db.run("INSERT INTO _punk_migrations (name, ran_at) VALUES (?, ?)", [
                    name,
                    new Date().toISOString()
                ]);
            });
            Logger.success(`Done: ${name}`, "Migrations");
            applied.push(name);
        }
        return applied;
    }

    // ── Rollback ──────────────────────────────────────────────────────────────

    /** Roll back a specific migration by name. */
    public async rollback(migrationsDir: string, migrationName: string): Promise<void> {
        const executed = await this.getExecuted();
        const record = executed.find((r) => r.name === migrationName);
        if (!record) {
            throw new Error(`Migration "${migrationName}" was not found in executed migrations.`);
        }

        const files = await this.getMigrationFiles(migrationsDir);
        const filePath = files.find((f) => path.basename(f, ".ts") === migrationName);
        if (!filePath) {
            throw new Error(`Migration file for "${migrationName}" not found in ${migrationsDir}`);
        }

        const migration = await this.loadMigration(filePath);
        Logger.warn(`Rolling back: ${migrationName}`, "Migrations");
        await this.db.transaction(async () => {
            await migration.down(this.db);
            await this.db.run("DELETE FROM _punk_migrations WHERE name = ?", [migrationName]);
        });
        Logger.success("Done", "Migrations");
    }

    /** Roll back ALL executed migrations in reverse order. */
    public async flush(migrationsDir: string): Promise<void> {
        const executed = await this.getExecuted();
        if (executed.length === 0) {
            Logger.success("No migrations to roll back.", "Migrations");
            return;
        }
        const reversed = [...executed].reverse();
        for (const record of reversed) {
            await this.rollback(migrationsDir, record.name);
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    /** Return all `.ts` migration files sorted chronologically by filename. */
    public async getMigrationFiles(migrationsDir: string): Promise<Array<string>> {
        const glob = new Bun.Glob("*.ts");
        const files: Array<string> = [];
        const absDir = path.resolve(migrationsDir);

        try {
            for await (const file of glob.scan({ cwd: absDir })) {
                if (!file.endsWith(".test.ts")) {
                    files.push(path.join(absDir, file));
                }
            }
        } catch {
            // Directory may not exist yet
        }

        return files.sort();
    }

    /** Dynamically import a migration file and return an instance. */
    private async loadMigration(filePath: string): Promise<Migration> {
        const mod = (await import(filePath)) as MigrationModule;

        let MigrationClass: (new () => Migration) | undefined;

        if (mod.default && typeof mod.default === "function") {
            MigrationClass = mod.default as new () => Migration;
        } else {
            for (const key of Object.keys(mod)) {
                if (typeof mod[key] === "function") {
                    MigrationClass = mod[key] as new () => Migration;
                    break;
                }
            }
        }

        if (!MigrationClass) {
            throw new Error(`No migration class found in ${filePath}`);
        }

        return new MigrationClass();
    }
}
