import "reflect-metadata";
import type { IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";
import { DbSet } from "../dbset/DbSet.ts";
import { MigrationRunner } from "../schema/MigrationRunner.ts";
import { Logger } from "../utils/logger.ts";

type Constructor<T> = new (...args: Array<unknown>) => T;

export type LogLevel = "query" | "error" | "warn" | "info" | "schema";

export interface DataContextOptions {
    /**
     * Enable logging.
     * - `true`: logs everything (queries, errors, etc.)
     * - `false`: disables all logging
     * - `Array<LogLevel>`: only logs specific levels
     */
    logging?: boolean | Array<LogLevel>;
    /**
     * Automatically run pending migrations on initialize.
     * Defaults to true.
     */
    autoMigrations?: boolean;
}

/**
 * Base class for data contexts — the central entry point for database access.
 */
export abstract class DataContext {
    protected readonly options: DataContextOptions;

    public constructor(
        protected readonly db: IDatabaseAdapter,
        options: DataContextOptions = {}
    ) {
        this.options = {
            autoMigrations: true,
            ...options
        };

        // Wrap adapter if any logging is enabled
        if (this.options.logging) {
            this.db = this.wrapAdapterForLogging(this.db);
        }
    }

    private shouldLog(level: LogLevel): boolean {
        const { logging } = this.options;
        if (logging === true) return true;
        if (Array.isArray(logging)) return logging.includes(level);
        return false;
    }

    private wrapAdapterForLogging(adapter: IDatabaseAdapter): IDatabaseAdapter {
        return {
            dialect: adapter.dialect,
            run: async (sql: string, params?: Array<unknown>): Promise<void> => {
                const start = performance.now();
                try {
                    await adapter.run(sql, params);
                    if (this.shouldLog("query")) {
                        const duration = (performance.now() - start).toFixed(2);
                        Logger.debug(`Query: ${sql} [${duration}ms]`, "Database");
                    }
                } catch (err) {
                    if (this.shouldLog("error")) {
                        Logger.error(`Error executing query: ${sql}`, "Database");
                        Logger.error(err instanceof Error ? err.message : String(err), "Database");
                    }
                    throw err;
                }
            },
            query: async <T = Record<string, unknown>>(
                sql: string,
                params?: Array<unknown>
            ): Promise<Array<T>> => {
                const start = performance.now();
                try {
                    const result = await adapter.query<T>(sql, params);
                    if (this.shouldLog("query")) {
                        const duration = (performance.now() - start).toFixed(2);
                        Logger.debug(`Query: ${sql} [${duration}ms]`, "Database");
                    }
                    return result;
                } catch (err) {
                    if (this.shouldLog("error")) {
                        Logger.error(`Error executing query: ${sql}`, "Database");
                        Logger.error(err instanceof Error ? err.message : String(err), "Database");
                    }
                    throw err;
                }
            },
            transaction: (fn: () => Promise<void>) => adapter.transaction(fn),
            close: () => adapter.close()
        };
    }

    /**
     * Run schema migrations for all registered entities.
     * Call this once on app startup before performing any queries.
     */
    public async initialize(): Promise<void> {
        if (this.options.autoMigrations) {
            const runner = new MigrationRunner(this.db);
            await runner.run();
        }
        await this.onModelCreating();
    }

    /**
     * Hook called at the end of initialize().
     * Override this in your subclass to seed data or perform initial setup.
     */
    protected async onModelCreating(): Promise<void> {
        // Optional hook for subclasses
    }

    /**
     * Create a typed DbSet for the given entity class.
     */
    protected set<T extends object>(EntityClass: Constructor<T>): DbSet<T> {
        return new DbSet<T>(this.db, EntityClass);
    }

    /**
     * Expose the raw adapter for custom SQL when needed.
     */
    public get adapter(): IDatabaseAdapter {
        return this.db;
    }

    /**
     * Close the underlying database connection.
     */
    public close(): void {
        this.db.close();
    }
}
