import type { DatabaseDialect, IDatabaseAdapter } from "./DatabaseAdapter.ts";

/**
 * PostgreSQL adapter using the `postgres` (postgres.js) driver.
 *
 * Note: Requires `postgres` package to be installed.
 */
export class PostgresAdapter implements IDatabaseAdapter {
    public readonly dialect: DatabaseDialect = "postgres";
    private sql: any;

    private connectionString: string;
    private options: any;

    /**
     * @param connectionString e.g. "postgres://user:pass@localhost:5432/db"
     * @param options Driver-specific options
     */
    public constructor(connectionString: string, options: any = {}) {
        this.connectionString = connectionString;
        this.options = options;
    }

    public async run(sql: string, params: Array<unknown> = []): Promise<void> {
        await this.ensureConnected();
        await this.sql.unsafe(this.convertPlaceholders(sql), params);
    }

    public async query<T = Record<string, unknown>>(
        sql: string,
        params: Array<unknown> = []
    ): Promise<Array<T>> {
        await this.ensureConnected();
        return await this.sql.unsafe(this.convertPlaceholders(sql), params);
    }

    public async transaction(fn: () => Promise<void>): Promise<void> {
        await this.ensureConnected();
        await this.sql.begin(async (sql: any) => {
            const originalSql = this.sql;
            this.sql = sql;
            try {
                await fn();
            } finally {
                this.sql = originalSql;
            }
        });
    }

    public close(): void {
        if (this.sql) {
            this.sql.end();
        }
    }

    public quote(identifier: string): string {
        return `"${identifier}"`;
    }

    public async ensureDatabaseExists(): Promise<void> {
        const regex = /^(\w+):\/\/(.+@)?([^/?#:]+)(?::(\d+))?(\/[^?#]*)?/;
        const match = this.connectionString.match(regex);
        if (!match) return;

        const targetDb = match[5] ? match[5].slice(1) : "";
        if (!targetDb || targetDb === "postgres") return;

        // Connect to maintenance database 'postgres' to check/create the target db
        // We rebuild the maintenance string safely
        const protocol = match[1];
        const auth = match[2] || "";
        const host = match[3];
        const port = match[4] ? `:${match[4]}` : "";
        const maintenanceString = `${protocol}://${auth}${host}${port}/postgres`;

        const { default: postgres } = await import("postgres" as any);
        const sql = postgres(maintenanceString, { ...this.options, max: 1 });

        try {
            const exists = await sql`SELECT 1 FROM pg_database WHERE datname = ${targetDb}`;
            if (exists.length === 0) {
                // CREATE DATABASE cannot run inside a transaction or with parameters in some drivers,
                // but postgres.js allows it via unsafe if needed.
                await sql.unsafe(`CREATE DATABASE "${targetDb.replace(/"/g, '""')}"`);
            }
        } finally {
            await sql.end();
        }
    }

    private async ensureConnected() {
        if (!this.sql) {
            try {
                const { default: postgres } = await import("postgres" as any);
                this.sql = postgres(this.connectionString, this.options);
            } catch (err) {
                throw new Error(
                    "Postgres driver 'postgres' not found. Please install it with 'bun add postgres'.",
                    { cause: err }
                );
            }
        }
    }

    /**
     * Converts '?' placeholders to '$1', '$2', etc.
     */
    private convertPlaceholders(sql: string): string {
        let index = 1;
        return sql.replace(/\?/g, () => `$${index++}`);
    }
}
