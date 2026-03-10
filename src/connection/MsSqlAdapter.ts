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
     * @param config Connection configuration for mssql or a connection string
     */
    public constructor(config: any) {
        if (typeof config === "string") {
            this.config = this.parseConnectionString(config);
        } else {
            this.config = config;
        }
    }

    private parseConnectionString(connectionString: string): any {
        // Regex to match mssql://user:pass@host:port/database
        // Uses greedy matching for the user:pass part to handle @ and # in passwords
        const regex = /^(\w+):\/\/(.+@)?([^/?#:]+)(?::(\d+))?(\/[^?#]*)?/;
        const match = connectionString.match(regex);

        if (match) {
            // protocol = match[1]
            let user = "";
            let password = "";
            const auth = match[2]; // "user:pass@"
            if (auth) {
                const innerAuth = auth.slice(0, -1);
                const colonIndex = innerAuth.indexOf(":");
                if (colonIndex !== -1) {
                    user = innerAuth.slice(0, colonIndex);
                    password = innerAuth.slice(colonIndex + 1);
                } else {
                    user = innerAuth;
                }
            }

            const server = match[3];
            const port = match[4] ? parseInt(match[4]) : 1433;
            const database = match[5] ? match[5].slice(1) : "";

            return {
                server,
                port,
                user: decodeURIComponent(user),
                password: decodeURIComponent(password),
                database: decodeURIComponent(database),
                options: {
                    encrypt: true,
                    trustServerCertificate: true
                }
            };
        }

        return connectionString;
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

    public quote(identifier: string): string {
        return `[${identifier}]`;
    }

    public async ensureDatabaseExists(): Promise<void> {
        let dbName = this.config.database;

        // If it's a string, try to extract database name if it looks like a URL
        if (typeof this.config === "string") {
            try {
                const match = this.config.match(/\/([^/?#]+)([?#]|$)/);
                if (match) dbName = match[1];
            } catch {
                /* ignore */
            }
        }

        if (!dbName) return;

        await this.ensureConnected();
        const mssql = await import("mssql" as any);
        // Connect to master database to check/create target
        let masterPool: any;
        if (typeof this.config === "string") {
            // Very naive replacement for URL-style strings
            const masterUrl = this.config.replace(`/${dbName}`, "/master");
            masterPool = new mssql.ConnectionPool(masterUrl);
        } else {
            const masterConfig = { ...this.config, database: "master" };
            masterPool = new mssql.ConnectionPool(masterConfig);
        }

        await masterPool.connect();

        try {
            await masterPool.request().query(
                `IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = '${dbName}')
                 CREATE DATABASE [${dbName}]`
            );
        } finally {
            await masterPool.close();
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
