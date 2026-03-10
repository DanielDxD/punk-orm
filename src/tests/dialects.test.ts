/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, it } from "bun:test";
import { DatabaseDialect, IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";
import { EntityMetadata } from "../metadata/EntityMetadata.ts";
import { SchemaBuilder } from "../schema/SchemaBuilder.ts";

class MockAdapter implements IDatabaseAdapter {
    public constructor(public readonly dialect: DatabaseDialect) {}
    public async run(sql: string, params?: Array<unknown>): Promise<void> {
        /* empty */
    }
    public async query<T>(sql: string, params?: Array<unknown>): Promise<Array<T>> {
        return [];
    }
    public async transaction(fn: () => Promise<void>): Promise<void> {
        await fn();
    }
    public close(): void {
        /* empty */
    }
    public quote(identifier: string): string {
        switch (this.dialect) {
            case "postgres":
                return `"${identifier}"`;
            case "mysql":
                return `\`${identifier}\``;
            case "mssql":
                return `[${identifier}]`;
            case "sqlite":
            default:
                return identifier;
        }
    }
    public async ensureDatabaseExists(): Promise<void> {
        /* empty */
    }
}

const mockMeta: EntityMetadata = {
    target: class User {},
    tableName: "users",
    columns: [
        {
            columnName: "id",
            propertyKey: "id",
            type: "uuid",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "uuid",
            nullable: false,
            unique: true
        },
        {
            columnName: "name",
            propertyKey: "name",
            type: "text",
            nullable: false,
            unique: false,
            isPrimary: false,
            isGenerated: false
        },
        {
            columnName: "age",
            propertyKey: "age",
            type: "integer",
            nullable: true,
            default: 18,
            unique: false,
            isPrimary: false,
            isGenerated: false
        }
    ],
    relations: []
};

describe("Dialect SQL Generation", () => {
    it("should generate correct SQLite DDL", () => {
        const builder = new SchemaBuilder(new MockAdapter("sqlite"));
        const idDef = builder.buildColumnDef(mockMeta.columns[0]!);
        const nameDef = builder.buildColumnDef(mockMeta.columns[1]!);

        expect(idDef).toContain("TEXT PRIMARY KEY");
        expect(nameDef).toContain("TEXT NOT NULL");
    });

    it("should generate correct Postgres DDL", () => {
        const builder = new SchemaBuilder(new MockAdapter("postgres"));
        const idDef = builder.buildColumnDef(mockMeta.columns[0]!);
        const nameDef = builder.buildColumnDef(mockMeta.columns[1]!);

        expect(idDef).toBe('"id" UUID PRIMARY KEY');
        expect(nameDef).toBe('"name" TEXT NOT NULL');
    });

    it("should generate correct MySQL DDL", () => {
        const builder = new SchemaBuilder(new MockAdapter("mysql"));
        const idDef = builder.buildColumnDef(mockMeta.columns[0]!);
        const nameDef = builder.buildColumnDef(mockMeta.columns[1]!);

        expect(idDef).toBe("`id` VARCHAR(36) PRIMARY KEY");
        expect(nameDef).toBe("`name` TEXT NOT NULL");
    });

    it("should generate correct MSSQL DDL", () => {
        const builder = new SchemaBuilder(new MockAdapter("mssql"));
        const idDef = builder.buildColumnDef(mockMeta.columns[0]!);
        const nameDef = builder.buildColumnDef(mockMeta.columns[1]!);

        expect(idDef).toBe("[id] UNIQUEIDENTIFIER PRIMARY KEY");
        expect(nameDef).toBe("[name] NVARCHAR(MAX) NOT NULL");
    });
});
