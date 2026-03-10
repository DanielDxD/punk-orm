export type DatabaseDialect = "sqlite" | "postgres" | "mysql" | "mssql";

/**
 * Database adapter interface — allows swapping drivers (SQLite, PG, etc.)
 */
export interface IDatabaseAdapter {
    /** The SQL dialect used by this adapter */
    readonly dialect: DatabaseDialect;

    /** Execute a write statement (INSERT / UPDATE / DELETE / DDL) */
    run(sql: string, params?: Array<unknown>): Promise<void>;

    /** Execute a SELECT and return typed rows */
    query<T = Record<string, unknown>>(sql: string, params?: Array<unknown>): Promise<Array<T>>;

    /** Execute multiple statements inside a single transaction */
    transaction(fn: () => Promise<void>): Promise<void>;

    /** Close the connection */
    close(): void;
}
