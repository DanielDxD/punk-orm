/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, spyOn, test } from "bun:test";
import type { DatabaseDialect, IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";
import { MigrationManager } from "../migrations/MigrationManager.ts";

class MockAdapter implements IDatabaseAdapter {
    public dialect: DatabaseDialect;
    public constructor(dialect: DatabaseDialect) {
        this.dialect = dialect;
    }
    public async run(_sql: string, _params?: Array<unknown>): Promise<void> {
        /* empty */
    }
    public async query<T = Record<string, unknown>>(
        _sql: string,
        _params?: Array<unknown>
    ): Promise<Array<T>> {
        return [] as any;
    }
    public async transaction(fn: () => Promise<void>): Promise<void> {
        await fn();
    }
    public close(): void {
        /* empty */
    }

    public quote(identifier: string): string {
        if (this.dialect === "postgres") return `"${identifier}"`;
        if (this.dialect === "mysql") return `\`${identifier}\``;
        if (this.dialect === "mssql") return `[${identifier}]`;
        return identifier;
    }
}

describe("MigrationManager Dialects", () => {
    test("should use SERIAL for Postgres", async () => {
        const adapter = new MockAdapter("postgres");
        const runSpy = spyOn(adapter, "run");
        const manager = new MigrationManager(adapter);

        await manager.ensureTable();

        const callSql = runSpy.mock.calls[0]![0];
        expect(callSql).toContain("SERIAL PRIMARY KEY");
    });

    test("should use IDENTITY for MSSQL", async () => {
        const adapter = new MockAdapter("mssql");
        const runSpy = spyOn(adapter, "run");
        const manager = new MigrationManager(adapter);

        await manager.ensureTable();

        const callSql = runSpy.mock.calls[0]![0];
        expect(callSql).toContain("IDENTITY(1,1)");
    });

    test("should use AUTO_INCREMENT for MySQL", async () => {
        const adapter = new MockAdapter("mysql");
        const runSpy = spyOn(adapter, "run");
        const manager = new MigrationManager(adapter);

        await manager.ensureTable();

        const callSql = runSpy.mock.calls[0]![0];
        expect(callSql).toContain("AUTO_INCREMENT");
    });

    test("should use AUTOINCREMENT for SQLite", async () => {
        const adapter = new MockAdapter("sqlite");
        const runSpy = spyOn(adapter, "run");
        const manager = new MigrationManager(adapter);

        await manager.ensureTable();

        const callSql = runSpy.mock.calls[0]![0];
        expect(callSql).toContain("AUTOINCREMENT");
    });
});
