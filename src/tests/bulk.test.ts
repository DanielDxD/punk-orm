/* eslint-disable @typescript-eslint/no-unused-vars */
import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { DatabaseDialect, IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";
import { DbSet } from "../dbset/DbSet.ts";
import { Column, Entity, PrimaryGeneratedColumn } from "../index.ts";

// Mock Adapter to capture SQL
class CaptureAdapter implements IDatabaseAdapter {
    public readonly dialect: DatabaseDialect = "sqlite";
    public lastSql: string = "";
    public lastParams: Array<unknown> = [];

    public async run(sql: string, params: Array<unknown> = []): Promise<void> {
        this.lastSql = sql;
        this.lastParams = params;
    }
    public async query<T>(sql: string, params: Array<unknown> = []): Promise<Array<T>> {
        return [];
    }
    public async transaction(fn: () => Promise<void>): Promise<void> {
        await fn();
    }
    public close(): void {
        /* empty */
    }
    public quote(identifier: string): string {
        return identifier;
    }
    public async ensureDatabaseExists(): Promise<void> {
        /* empty */
    }
}

@Entity("bulk_entities")
class BulkEntity {
    @PrimaryGeneratedColumn("uuid")
    public id!: string;

    @Column({ type: "text" })
    public name!: string;

    @Column({ type: "integer", default: 0 })
    public score!: number;
}

describe("DbSet Bulk Operations", () => {
    let adapter: CaptureAdapter;
    let dbSet: DbSet<BulkEntity>;

    beforeEach(() => {
        adapter = new CaptureAdapter();
        dbSet = new DbSet<BulkEntity>(adapter, BulkEntity);
    });

    it("should generate correct bulkInsert SQL", async () => {
        const entities = [
            dbSet.create({ name: "Alice", score: 10 }),
            dbSet.create({ name: "Bob", score: 20 })
        ];

        await dbSet.bulkInsert(entities);

        expect(adapter.lastSql).toContain("INSERT INTO bulk_entities");
        expect(adapter.lastSql).toContain("VALUES (?, ?, ?), (?, ?, ?)");
        expect(adapter.lastParams.length).toBe(6); // 3 columns * 2 rows
        expect(adapter.lastParams[1]).toBe("Alice");
        expect(adapter.lastParams[2]).toBe(10);
        expect(adapter.lastParams[4]).toBe("Bob");
    });

    it("should generate correct bulkUpdate SQL with CASE", async () => {
        const entities = [
            dbSet.create({ id: "uuid-1", name: "Alice Updated", score: 15 }),
            dbSet.create({ id: "uuid-2", name: "Bob Updated", score: 25 })
        ];

        await dbSet.bulkUpdate(entities);

        expect(adapter.lastSql).toContain("UPDATE bulk_entities SET");
        expect(adapter.lastSql).toContain("name = CASE");
        expect(adapter.lastSql).toContain("score = CASE");
        expect(adapter.lastSql).toContain("WHERE id IN (?, ?)");
        // Params: (id, val) * 2 per column, plus IDs for WHERE IN
        // columns = name, score.
        // name: WHEN id=? THEN ? WHEN id=? THEN ? (4 params)
        // score: WHEN id=? THEN ? WHEN id=? THEN ? (4 params)
        // WHERE: id IN (?, ?) (2 params)
        // Total: 4 + 4 + 2 = 10
        expect(adapter.lastParams.length).toBe(10);
        expect(adapter.lastParams).toContain("Alice Updated");
        expect(adapter.lastParams).toContain("uuid-1");
    });

    it("should generate correct bulkDelete SQL", async () => {
        const entities = [{ id: "uuid-1" }, { id: "uuid-2" }, "uuid-3"];

        await dbSet.bulkDelete(entities);

        expect(adapter.lastSql).toBe("DELETE FROM bulk_entities WHERE id IN (?, ?, ?)");
        expect(adapter.lastParams).toEqual(["uuid-1", "uuid-2", "uuid-3"]);
    });

    it("should handle chunking in bulkInsert", async () => {
        const entities = [];
        for (let i = 0; i < 600; i++) {
            entities.push(dbSet.create({ name: `User ${i}` }));
        }

        const runSpy = spyOn(adapter, "run");
        await dbSet.bulkInsert(entities);

        // Chunk size is 500, so 600 items should result in 2 calls
        expect(runSpy).toHaveBeenCalledTimes(2);
    });
});
