/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, it, spyOn } from "bun:test";
import { DatabaseDialect, IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";
import { DataContext } from "../context/DataContext.ts";
import { Logger } from "../utils/logger.ts";

// Mock Adapter
class MockAdapter implements IDatabaseAdapter {
    public readonly dialect: DatabaseDialect = "sqlite";
    public async run(sql: string, params?: Array<unknown>): Promise<void> {
        /* empty */
    }
    public async query<T>(sql: string, params?: Array<unknown>): Promise<Array<T>> {
        return [] as any;
    }
    public async transaction(fn: () => Promise<void>): Promise<void> {
        await fn();
    }
    public close(): void {
        /* empty */
    }
}

class TestContext extends DataContext {}

describe("DataContext Configuration", () => {
    it("should log queries when logging: true", async () => {
        const adapter = new MockAdapter();
        const debugSpy = spyOn(Logger, "debug");

        const ctx = new TestContext(adapter, { logging: true });
        await ctx.adapter.run("SELECT 1");

        expect(debugSpy).toHaveBeenCalled();
        debugSpy.mockRestore();
    });

    it("should log queries when logging: ['query']", async () => {
        const adapter = new MockAdapter();
        const debugSpy = spyOn(Logger, "debug");

        const ctx = new TestContext(adapter, { logging: ["query"] });
        await ctx.adapter.run("SELECT 1");

        expect(debugSpy).toHaveBeenCalled();
        debugSpy.mockRestore();
    });

    it("should NOT log queries when logging: false", async () => {
        const debugSpy = spyOn(Logger, "debug");

        const ctx = new TestContext(new MockAdapter(), { logging: false });
        await ctx.adapter.run("SELECT 1");

        expect(debugSpy).not.toHaveBeenCalled();
        debugSpy.mockRestore();
    });

    it("should log errors when logging: ['error']", async () => {
        const adapter = new MockAdapter();
        adapter.run = async () => {
            throw new Error("Boom");
        };

        const errorSpy = spyOn(Logger, "error");

        const ctx = new TestContext(adapter, { logging: ["error"] });
        try {
            await ctx.adapter.run("SELECT 1");
        } catch {
            /* empty */
        }

        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it("should skip autoMigrations when set to false", async () => {
        // This is harder to test without mocking MigrationRunner,
        // but we can at least check if initialization works and doesn't crash
        // if we don't have a real DB.
        const adapter = new MockAdapter();
        const ctx = new TestContext(adapter, { autoMigrations: false });

        // Should not throw even if table_info fails because it's not called
        await ctx.initialize();
    });
});
