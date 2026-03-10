import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import "reflect-metadata";
import { BunSQLiteAdapter, Column, DataContext, Entity, PrimaryGeneratedColumn } from "../index.ts";

@Entity("seed_users")
class User {
    @PrimaryGeneratedColumn("uuid")
    public id: string;

    @Column({ type: "text" })
    public name: string;
}

class SeedContext extends DataContext {
    public users = this.set(User);

    protected override async onModelCreating(): Promise<void> {
        const alice = this.users.create({ name: "Alice" });
        this.users.add(alice);
        await this.users.saveChanges();
    }
}

describe("DataContext — seeding", () => {
    let ctx: SeedContext;

    beforeAll(async () => {
        ctx = new SeedContext(new BunSQLiteAdapter(":memory:"));
        await ctx.initialize();
    });

    afterAll(() => ctx.close());

    it("should have seeded data after initialize()", async () => {
        const alice = await ctx.users.where((q) => q.eq("name", "Alice")).firstOrDefault();
        expect(alice).not.toBeNull();
        expect(alice?.name).toBe("Alice");
    });
});
