import type { DatabaseDialect, IDatabaseAdapter } from "./DatabaseAdapter.ts";

/**
 * Microsoft SQL Server adapter using `mssql` or `tedious`.
 *
 * Note: Requires `mssql` package to be installed.
 */
export class MsSqlAdapter implements IDatabaseAdapter {
    public readonly dialect: DatabaseDialect = "mssql";
    private config: any;
    private mssql: any;
    private pool: any;

    /**
     * @param config Connection configuration for mssql
     */
    public constructor(config: any) {
        this.config = config;
    }

    private async connect() {
        if (!this.pool.connected && !this.pool.connecting) {
            await this.pool.connect();
        }
    }

    public async run(sql: string, params: Array<unknown> = []): Promise<void> {
        await this.ensureConnected();
        await this.connect();
        const request = this.pool.request();
        this.applyParams(request, params);
        await request.query(this.convertPlaceholders(sql));
    }

    public async query<T = Record<string, unknown>>(
        sql: string,
        params: Array<unknown> = []
    ): Promise<Array<T>> {
        await this.ensureConnected();
        await this.connect();
        const request = this.pool.request();
        this.applyParams(request, params);
        const result = await request.query(this.convertPlaceholders(sql));
        return result.recordset as Array<T>;
    }

    public async transaction(fn: () => Promise<void>): Promise<void> {
        await this.ensureConnected();
        await this.connect();

        const transaction = new this.mssql.Transaction(this.pool);

        await transaction.begin();
        const originalPool = this.pool;
        this.pool = transaction; // Use transaction as the request source

        try {
            await fn();
            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        } finally {
            this.pool = originalPool;
        }
    }

    public close(): void {
        if (this.pool) {
            this.pool.close();
        }
    }

    private async ensureConnected() {
        if (!this.mssql) {
            try {
                this.mssql = await import("mssql" as any);
                this.pool = new this.mssql.ConnectionPool(this.config);
            } catch (err) {
                throw new Error(
                    "MSSQL driver 'mssql' not found. Please install it with 'bun add mssql'.",
                    { cause: err }
                );
            }
        }
    }

    private applyParams(request: any, params: Array<unknown>) {
        params.forEach((val, i) => {
            request.input(`p${i + 1}`, val);
        });
    }

    /**
     * Converts '?' placeholders to '@p1', '@p2', etc.
     */
    private convertPlaceholders(sql: string): string {
        let index = 1;
        return sql.replace(/\?/g, () => `@p${index++}`);
    }
}
