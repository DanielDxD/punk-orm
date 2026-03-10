import type { DatabaseDialect, IDatabaseAdapter } from "./DatabaseAdapter.ts";

/**
 * MySQL / MariaDB adapter using `mysql2/promise`.
 *
 * Note: Requires `mysql2` package to be installed.
 */
export class MySqlAdapter implements IDatabaseAdapter {
    public readonly dialect: DatabaseDialect = "mysql";
    private options: any;
    private connection: any;

    /**
     * @param options Connection options for mysql2 or a connection string
     */
    public constructor(options: any) {
        if (typeof options === "string") {
            this.options = this.parseConnectionString(options);
        } else {
            this.options = options;
        }
    }

    private parseConnectionString(connectionString: string): any {
        try {
            const url = new URL(connectionString);
            return {
                host: url.hostname,
                port: url.port ? parseInt(url.port) : 3306,
                user: url.username,
                password: url.password,
                database: url.pathname.slice(1)
            };
        } catch {
            // Fallback for non-URL strings if needed, or just let mysql2 handle it if possible.
            // But here we need to extract 'database' for ensureDatabaseExists.
            return { uri: connectionString };
        }
    }

    public async run(sql: string, params: Array<unknown> = []): Promise<void> {
        await this.ensureConnected();
        await this.connection.execute(sql, params);
    }

    public async query<T = Record<string, unknown>>(
        sql: string,
        params: Array<unknown> = []
    ): Promise<Array<T>> {
        await this.ensureConnected();
        const [rows] = await this.connection.execute(sql, params);
        return rows as Array<T>;
    }

    public async transaction(fn: () => Promise<void>): Promise<void> {
        await this.ensureConnected();
        const conn = await this.connection.getConnection();
        await conn.beginTransaction();
        const originalConn = this.connection;
        this.connection = conn; // Use the specific connection for the transaction
        try {
            await fn();
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            this.connection = originalConn;
            conn.release();
        }
    }

    public close(): void {
        if (this.connection && typeof this.connection.end === "function") {
            this.connection.end();
        }
    }

    public quote(identifier: string): string {
        return `\`${identifier}\``;
    }

    public async ensureDatabaseExists(): Promise<void> {
        const dbName = this.options.database;
        if (!dbName) return;

        const mysql = await import("mysql2/promise" as any);
        // Connect without a database to check/create it
        const connection = await mysql.createConnection({
            ...this.options,
            database: undefined
        });

        try {
            await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
        } finally {
            await connection.end();
        }
    }

    private async ensureConnected() {
        if (!this.connection) {
            try {
                const mysql = await import("mysql2/promise" as any);
                this.connection = mysql.createPool(this.options);
            } catch (err) {
                throw new Error(
                    "MySQL driver 'mysql2' not found. Please install it with 'bun add mysql2'.",
                    { cause: err }
                );
            }
        }
    }
}
