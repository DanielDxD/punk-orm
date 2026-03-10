/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, spyOn, test } from "bun:test";
import type { DatabaseDialect, IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";
import { SchemaDiffer } from "../migrations/SchemaDiffer.ts";

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

describe("SchemaDiffer Introspection", () => {
    test("should use information_schema for Postgres", async () => {
        const adapter = new MockAdapter("postgres");
        const querySpy = spyOn(adapter, "query").mockImplementation(async (sql: string) => {
            if (sql.includes("information_schema.tables")) return [{ "1": 1 }] as any;
            if (sql.includes("information_schema.columns"))
                return [{ name: "id" }, { name: "name" }] as any;
            return [];
        });

        const differ = new SchemaDiffer(adapter);

        // Internal test of private methods via any
        const exists = await (differ as any).tableExists("users");
        expect(exists).toBe(true);
        expect(querySpy).toHaveBeenCalledWith(
            "SELECT 1 FROM information_schema.tables WHERE table_name = ?",
            ["users"]
        );

        const columns = await (differ as any).getExistingColumns("users");
        expect(columns.has("id")).toBe(true);
        expect(columns.has("name")).toBe(true);
        expect(querySpy).toHaveBeenCalledWith(
            "SELECT column_name as name FROM information_schema.columns WHERE table_name = ?",
            ["users"]
        );
    });

    test("should use sqlite_master for SQLite", async () => {
        const adapter = new MockAdapter("sqlite");
        const querySpy = spyOn(adapter, "query").mockImplementation(async (sql: string) => {
            if (sql.includes("sqlite_master")) return [{ name: "users" }] as any;
            if (sql.includes("PRAGMA table_info"))
                return [
                    { name: "id", type: "INTEGER", notnull: 1, dflt_value: null, pk: 1 },
                    { name: "name", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 }
                ] as any;
            return [];
        });

        const differ = new SchemaDiffer(adapter);

        const exists = await (differ as any).tableExists("users");
        expect(exists).toBe(true);
        expect(querySpy).toHaveBeenCalledWith(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            ["users"]
        );

        const columns = await (differ as any).getExistingColumns("users");
        expect(columns.has("id")).toBe(true);
        expect(columns.get("id").type).toBe("INTEGER");
    });
});
