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
