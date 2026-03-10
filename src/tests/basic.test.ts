import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import "reflect-metadata";
import {
    BunSQLiteAdapter,
    Column,
    DataContext,
    Entity,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    QueryBuilder
} from "../index.ts";

// ── Test Entities ────────────────────────────────────────────────────────────

@Entity("test_users")
class User {
    @PrimaryGeneratedColumn("uuid")
    public id: string;

    @Column({ type: "text" })
    public name: string;

    @Column({ type: "text", unique: true })
    public email: string;

    @Column({ type: "boolean", default: true })
    public active: boolean;

    @OneToMany(() => Post, { foreignKey: "authorId" })
    public posts: Array<Post>;
}

@Entity("test_posts")
class Post {
    @PrimaryGeneratedColumn("uuid")
    public id: string;

    @Column({ type: "text" })
    public title: string;

    @Column({ type: "text", nullable: true })
    public body: string | null;

    @Column({ type: "integer", default: 0 })
    public views: number;

    @Column({ type: "text" })
    public authorId: string;

    @ManyToOne(() => User, { foreignKey: "authorId" })
    public author: User;
}

// ── Test Context ─────────────────────────────────────────────────────────────

class TestContext extends DataContext {
    public users = this.set(User);
    public posts = this.set(Post);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

let ctx: TestContext;

beforeAll(async () => {
    ctx = new TestContext(new BunSQLiteAdapter(":memory:"));
    await ctx.initialize();
});

afterAll(() => {
    ctx.close();
});

// ── Schema ────────────────────────────────────────────────────────────────────

describe("Schema", () => {
    it("creates tables on initialize()", async () => {
        const tables = await ctx.adapter.query<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('test_users','test_posts')"
        );
        const names = tables.map((t) => t.name);
        expect(names).toContain("test_users");
        expect(names).toContain("test_posts");
    });
});

// ── CRUD ──────────────────────────────────────────────────────────────────────

describe("DbSet — INSERT", () => {
    it("creates and persists a user", async () => {
        const user = ctx.users.create({ name: "Alice", email: "alice@test.com", active: true });
        ctx.users.add(user);
        await ctx.users.saveChanges();

        const found = await ctx.users.findOne({ email: "alice@test.com" });
        expect(found).not.toBeNull();
        expect(found!.name).toBe("Alice");
        expect(found!.id).toBeDefined();
    });

    it("auto-generates UUID primary keys", async () => {
        const u1 = ctx.users.create({ name: "Bob", email: "bob@test.com" });
        const u2 = ctx.users.create({ name: "Carol", email: "carol@test.com" });
        ctx.users.add(u1);
        ctx.users.add(u2);
        await ctx.users.saveChanges();

        const b = await ctx.users.findOneOrFail({ email: "bob@test.com" });
        const c = await ctx.users.findOneOrFail({ email: "carol@test.com" });
        expect(b.id).not.toBe(c.id);
        // UUID format (v7)
        expect(b.id).toMatch(/^[0-9a-f-]{36}$/);
    });
});

describe("DbSet — SELECT", () => {
    it("find() returns all entities", async () => {
        const users = await ctx.users.find();
        expect(users.length).toBeGreaterThanOrEqual(3);
    });

    it("find() supports where filter", async () => {
        const result = await ctx.users.find({ where: { name: "Alice" } });
        expect(result.length).toBe(1);
        expect(result[0]!.name).toBe("Alice");
    });

    it("find() supports take/skip pagination", async () => {
        const page1 = await ctx.users.find({ take: 2, skip: 0 });
        const page2 = await ctx.users.find({ take: 2, skip: 2 });
        expect(page1.length).toBe(2);
        // page2 might be 1 or more
        expect(page1[0]!.id).not.toBe(page2[0]?.id);
    });

    it("findOne() returns null for unknown entity", async () => {
        const result = await ctx.users.findOne({ email: "ghost@test.com" });
        expect(result).toBeNull();
    });

    it("findOneOrFail() throws if not found", async () => {
        expect(ctx.users.findOneOrFail({ email: "ghost@test.com" })).rejects.toThrow();
    });
});

describe("DbSet — UPDATE", () => {
    it("updates a field and persists it", async () => {
        const user = await ctx.users.findOneOrFail({ email: "alice@test.com" });
        user.name = "Alice Updated";
        ctx.users.update(user);
        await ctx.users.saveChanges();

        const updated = await ctx.users.findOneOrFail({ email: "alice@test.com" });
        expect(updated.name).toBe("Alice Updated");
    });
});

describe("DbSet — DELETE", () => {
    it("removes an entity", async () => {
        const user = ctx.users.create({ name: "Temp", email: "temp@test.com" });
        ctx.users.add(user);
        await ctx.users.saveChanges();

        const found = await ctx.users.findOneOrFail({ email: "temp@test.com" });
        ctx.users.remove(found);
        await ctx.users.saveChanges();

        const deleted = await ctx.users.findOne({ email: "temp@test.com" });
        expect(deleted).toBeNull();
    });
});

// ── Relations ─────────────────────────────────────────────────────────────────

describe("Relations", () => {
    it("creates posts linked to a user via authorId", async () => {
        const author = await ctx.users.findOneOrFail({ email: "alice@test.com" });

        const p1 = ctx.posts.create({
            title: "Post A",
            body: "Body A",
            views: 5,
            authorId: author.id
        });
        const p2 = ctx.posts.create({
            title: "Post B",
            body: null,
            views: 20,
            authorId: author.id
        });
        ctx.posts.add(p1);
        ctx.posts.add(p2);
        await ctx.posts.saveChanges();

        const posts = await ctx.posts.find({ where: { authorId: author.id } });
        expect(posts.length).toBe(2);
        expect(posts.every((p) => p.authorId === author.id)).toBe(true);
    });
});

// ── Query Builder ─────────────────────────────────────────────────────────────

describe("QueryBuilder", () => {
    it("builds a SELECT with orderBy and take", async () => {
        const top1 = await ctx.posts
            .createQueryBuilder()
            .orderBy("views", "DESC")
            .take(1)
            .getMany<Post>();

        expect(top1.length).toBe(1);
        expect(top1[0]!.views).toBe(20);
    });

    it("builds a SELECT with raw WHERE", async () => {
        const results = await ctx.posts
            .createQueryBuilder()
            .where("views > ?", [10])
            .getMany<Post>();

        expect(results.every((p) => p.views > 10)).toBe(true);
    });

    it("getOne() returns null when no row matches", async () => {
        const result = await new QueryBuilder(ctx.adapter)
            .from("test_posts")
            .where("title = ?", ["NonExistent"])
            .getOne();

        expect(result).toBeNull();
    });
});
