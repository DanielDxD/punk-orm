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
    WhereExpression
} from "../index.ts";

// ── Entities ────────────────────────────────────────────────────────────────

@Entity("linq_users")
class User {
    @PrimaryGeneratedColumn("uuid")
    public id: string;

    @Column({ type: "text" })
    public name: string;

    @Column({ type: "text", unique: true })
    public email: string;

    @Column({ type: "boolean", default: true })
    public active: boolean;

    @Column({ type: "integer", default: 0 })
    public score: number;

    @OneToMany(() => Post, { foreignKey: "authorId" })
    public posts: Array<Post>;
}

@Entity("linq_posts")
class Post {
    @PrimaryGeneratedColumn("uuid")
    public id: string;

    @Column({ type: "text" })
    public title: string;

    @Column({ type: "integer", default: 0 })
    public views: number;

    @Column({ type: "text" })
    public authorId: string;

    @ManyToOne(() => User, { foreignKey: "authorId" })
    public author: User;
}

class TestCtx extends DataContext {
    public users = this.set(User);
    public posts = this.set(Post);
}

let ctx: TestCtx;

beforeAll(async () => {
    ctx = new TestCtx(new BunSQLiteAdapter(":memory:"));
    await ctx.initialize();

    // Seed
    const alice = ctx.users.create({
        name: "Alice",
        email: "alice@linq.com",
        active: true,
        score: 90
    });
    const bob = ctx.users.create({ name: "Bob", email: "bob@linq.com", active: false, score: 40 });
    const carol = ctx.users.create({
        name: "Carol",
        email: "carol@linq.com",
        active: true,
        score: 75
    });
    const dana = ctx.users.create({
        name: "Dana",
        email: "dana@linq.com",
        active: true,
        score: 60
    });

    ctx.users.add(alice);
    ctx.users.add(bob);
    ctx.users.add(carol);
    ctx.users.add(dana);
    await ctx.users.saveChanges();

    // Re-fetch to get generated IDs reliably
    const a = await ctx.users.where((q) => q.eq("name", "Alice")).first();
    const c = await ctx.users.where((q) => q.eq("name", "Carol")).first();

    const p1 = ctx.posts.create({ title: "Hello World", views: 100, authorId: a.id });
    const p2 = ctx.posts.create({ title: "Bun is Fast", views: 250, authorId: a.id });
    const p3 = ctx.posts.create({ title: "TypeScript ORM", views: 50, authorId: c.id });
    ctx.posts.add(p1);
    ctx.posts.add(p2);
    ctx.posts.add(p3);
    await ctx.posts.saveChanges();
});

afterAll(() => ctx.close());

// ── WhereExpression unit tests ────────────────────────────────────────────────

describe("WhereExpression", () => {
    it("eq() builds equality clause", () => {
        const expr = new WhereExpression<User>().eq("name", "Alice");
        const { sql, params } = expr.build();
        expect(sql).toBe("name = ?");
        expect(params).toEqual(["Alice"]);
    });

    it("gt() + lte() chain with AND", () => {
        const expr = new WhereExpression<User>().gt("score", 50 as never).lte("score", 90 as never);
        const { sql, params } = expr.build();
        expect(sql).toBe("score > ? AND score <= ?");
        expect(params).toEqual([50, 90]);
    });

    it("contains() uses LIKE %value%", () => {
        const expr = new WhereExpression<User>().contains("name", "li");
        const { sql, params } = expr.build();
        expect(sql).toBe("name LIKE ?");
        expect(params).toEqual(["%li%"]);
    });

    it("in() builds IN clause", () => {
        const expr = new WhereExpression<User>().in("name", ["Alice", "Bob"]);
        const { sql, params } = expr.build();
        expect(sql).toBe("name IN (?, ?)");
        expect(params).toEqual(["Alice", "Bob"]);
    });

    it("or() builds grouped OR clause", () => {
        const expr = new WhereExpression<User>().eq("name", "Alice").or((q) => q.eq("name", "Bob"));
        const { sql, params } = expr.build();
        expect(sql).toBe("name = ? OR (name = ?)");
        expect(params).toEqual(["Alice", "Bob"]);
    });

    it("and() builds grouped AND clause", () => {
        const expr = new WhereExpression<User>()
            .eq("active", true as never)
            .and((q) => q.gt("score", 50 as never));
        const { sql, params } = expr.build();
        expect(sql).toBe("active = ? AND (score > ?)");
        expect(params).toEqual([true, 50]);
    });

    it("isNull() / isNotNull()", () => {
        const e1 = new WhereExpression<User>().isNull("name");
        expect(e1.build().sql).toBe("name IS NULL");

        const e2 = new WhereExpression<User>().isNotNull("name");
        expect(e2.build().sql).toBe("name IS NOT NULL");
    });

    it("between() builds BETWEEN clause", () => {
        const expr = new WhereExpression<User>().between("score", 40 as never, 90 as never);
        const { sql, params } = expr.build();
        expect(sql).toBe("score BETWEEN ? AND ?");
        expect(params).toEqual([40, 90]);
    });

    it("in() with empty array returns always-false clause", () => {
        const expr = new WhereExpression<User>().in("name", []);
        expect(expr.build().sql).toBe("1 = 0");
    });
});

// ── EntityQuery (via DbSet entry-points) ─────────────────────────────────────

describe("EntityQuery — toList / where", () => {
    it("toList() returns all rows", async () => {
        const all = await ctx.users.toList();
        expect(all.length).toBe(4);
    });

    it("where().toList() filters correctly", async () => {
        const active = await ctx.users.where((q) => q.eq("active", true as never)).toList();
        expect(active.every((u) => u.active)).toBe(true);
    });

    it("where with gt", async () => {
        const high = await ctx.users.where((q) => q.gt("score", 70 as never)).toList();
        expect(high.every((u) => u.score > 70)).toBe(true);
    });

    it("where with contains (LIKE)", async () => {
        const result = await ctx.users.where((q) => q.contains("name", "al")).toList();
        expect(result.some((u) => u.name === "Alice")).toBe(true);
    });

    it("multiple where() calls compose as AND", async () => {
        const result = await ctx.users
            .where((q) => q.eq("active", true as never))
            .where((q) => q.gt("score", 70 as never))
            .toList();
        expect(result.every((u) => u.active && u.score > 70)).toBe(true);
    });

    it("where with in()", async () => {
        const result = await ctx.users.where((q) => q.in("name", ["Alice", "Dana"])).toList();
        expect(result.length).toBe(2);
        expect(result.map((u) => u.name).sort()).toEqual(["Alice", "Dana"]);
    });
});

describe("EntityQuery — orderBy", () => {
    it("orderBy ASC sorts correctly", async () => {
        const users = await ctx.users.orderBy("score").toList();
        for (let i = 1; i < users.length; i++) {
            expect(users[i]!.score).toBeGreaterThanOrEqual(users[i - 1]!.score);
        }
    });

    it("orderByDescending sorts correctly", async () => {
        const users = await ctx.users.orderByDescending("score").toList();
        for (let i = 1; i < users.length; i++) {
            expect(users[i]!.score).toBeLessThanOrEqual(users[i - 1]!.score);
        }
    });

    it("thenBy as secondary sort", async () => {
        const users = await ctx.users
            .where((q) => q.eq("active", true as never))
            .orderBy("active")
            .thenBy("score", "DESC")
            .toList();
        expect(users[0]!.score).toBeGreaterThanOrEqual(users[1]!.score);
    });
});

describe("EntityQuery — skip / take", () => {
    it("take(2) returns first 2 rows", async () => {
        const users = await ctx.users.orderBy("name").take(2).toList();
        expect(users.length).toBe(2);
        expect(users[0]!.name).toBe("Alice");
        expect(users[1]!.name).toBe("Bob");
    });

    it("skip(2).take(2) pages correctly", async () => {
        const page1 = await ctx.users.orderBy("name").take(2).toList();
        const page2 = await ctx.users.orderBy("name").skip(2).take(2).toList();
        expect(page1[0]!.name).not.toBe(page2[0]!.name);
        expect(page2[0]!.name).toBe("Carol");
    });
});

describe("EntityQuery — first / firstOrDefault", () => {
    it("first() returns the first row", async () => {
        const u = await ctx.users.orderBy("name").first();
        expect(u.name).toBe("Alice");
    });

    it("first() throws when empty", async () => {
        expect(ctx.users.where((q) => q.eq("name", "Nobody")).first()).rejects.toThrow(
            "Sequence contains no elements"
        );
    });

    it("firstOrDefault() returns null when empty", async () => {
        const u = await ctx.users.where((q) => q.eq("name", "Nobody")).firstOrDefault();
        expect(u).toBeNull();
    });

    it("firstOrDefault() returns entity when found", async () => {
        const u = await ctx.users.where((q) => q.eq("name", "Alice")).firstOrDefault();
        expect(u?.name).toBe("Alice");
    });
});

describe("EntityQuery — single / singleOrDefault", () => {
    it("single() returns the unique match", async () => {
        const u = await ctx.users.where((q) => q.eq("name", "Alice")).single();
        expect(u.name).toBe("Alice");
    });

    it("single() throws when empty", async () => {
        expect(ctx.users.where((q) => q.eq("name", "Nobody")).single()).rejects.toThrow(
            "Sequence contains no elements"
        );
    });

    it("single() throws when more than one result", async () => {
        expect(ctx.users.where((q) => q.eq("active", true as never)).single()).rejects.toThrow(
            "Sequence contains more than one element"
        );
    });

    it("singleOrDefault() returns null when not found", async () => {
        const u = await ctx.users.where((q) => q.eq("name", "Nobody")).singleOrDefault();
        expect(u).toBeNull();
    });

    it("singleOrDefault() throws when more than one result", async () => {
        expect(
            ctx.users.where((q) => q.eq("active", true as never)).singleOrDefault()
        ).rejects.toThrow("Sequence contains more than one element");
    });
});

describe("EntityQuery — count / any / aggregates", () => {
    it("count() returns row count", async () => {
        const n = await ctx.users.count();
        expect(n).toBe(4);
    });

    it("count() with where", async () => {
        const n = await ctx.users.where((q) => q.eq("active", true as never)).count();
        expect(n).toBe(3);
    });

    it("any() returns true when rows exist", async () => {
        expect(await ctx.users.any()).toBe(true);
    });

    it("any() returns false when empty", async () => {
        const empty = await ctx.users.where((q) => q.eq("name", "Ghost")).any();
        expect(empty).toBe(false);
    });

    it("any(predicate) applies predicate", async () => {
        const hasHigh = await ctx.users.any((q) => q.gt("score", 80 as never));
        expect(hasHigh).toBe(true);
    });

    it("sum() computes total", async () => {
        const total = await ctx.users.sum("score");
        expect(total).toBe(90 + 40 + 75 + 60);
    });

    it("max() returns maximum", async () => {
        const max = await ctx.users.max("score");
        expect(max).toBe(90);
    });

    it("min() returns minimum", async () => {
        const min = await ctx.users.min("score");
        expect(min).toBe(40);
    });

    it("average() returns mean", async () => {
        const avg = await ctx.users.average("score");
        expect(avg).toBeCloseTo((90 + 40 + 75 + 60) / 4);
    });
});

describe("EntityQuery — select (projection)", () => {
    it("select() maps to a new shape", async () => {
        const labels = await ctx.users
            .where((q) => q.eq("active", true as never))
            .orderBy("name")
            .select((u) => ({ label: u.name, value: u.id }))
            .toList();

        expect(labels[0]).toHaveProperty("label");
        expect(labels[0]).toHaveProperty("value");
        expect(labels[0]!.label).toBe("Alice");
    });
});

describe("EntityQuery — posts with relations", () => {
    it("where on foreign key", async () => {
        const alice = await ctx.users.where((q) => q.eq("name", "Alice")).first();
        const alicePosts = await ctx.posts.where((q) => q.eq("authorId", alice.id)).toList();
        expect(alicePosts.length).toBe(2);
    });

    it("most viewed post via orderByDescending + first", async () => {
        const top = await ctx.posts.orderByDescending("views").first();
        expect(top.title).toBe("Bun is Fast");
        expect(top.views).toBe(250);
    });

    it("posts with views between 50 and 150", async () => {
        const mid = await ctx.posts
            .where((q) => q.between("views", 50 as never, 150 as never))
            .toList();
        expect(mid.every((p) => p.views >= 50 && p.views <= 150)).toBe(true);
    });
});
