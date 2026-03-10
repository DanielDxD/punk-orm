/**
 * PunkORM — Example: CRUD + LINQ-style queries
 *
 * Run with: bun run examples/basic.ts
 */
import "reflect-metadata";
import {
    BunSQLiteAdapter,
    Column,
    DataContext,
    Entity,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
} from "../src/index.ts";
import { Logger } from "../src/utils/logger.ts";

// ── Entities ─────────────────────────────────────────────────────────────────

@Entity("users")
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

@Entity("posts")
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

// ── Context ───────────────────────────────────────────────────────────────────

class AppContext extends DataContext {
    public users = this.set(User);
    public posts = this.set(Post);
}

// ── Demo ──────────────────────────────────────────────────────────────────────

async function main() {
    const ctx = new AppContext(new BunSQLiteAdapter(":memory:"));

    Logger.info("Initializing schema...", "Demo");
    await ctx.initialize();
    Logger.success("Schema ready!", "Demo");

    // ── INSERT ────────────────────────────────────────────────────────────────

    Logger.info("Creating users...", "Demo");
    const alice = ctx.users.create({ name: "Alice", email: "alice@punk.com", active: true, score: 90 });
    const bob = ctx.users.create({ name: "Bob", email: "bob@punk.com", active: false, score: 40 });
    const carol = ctx.users.create({ name: "Carol", email: "carol@punk.com", active: true, score: 75 });
    const dana = ctx.users.create({ name: "Dana", email: "dana@punk.com", active: true, score: 60 });
    ctx.users.add(alice);
    ctx.users.add(bob);
    ctx.users.add(carol);
    ctx.users.add(dana);
    await ctx.users.saveChanges();

    // ── LINQ queries ──────────────────────────────────────────────────────────

    Logger.info("LINQ — active users ordered by score (desc):", "Demo");
    const activeUsers = await ctx.users
        .where(q => q.eq("active", true as never))
        .orderByDescending("score")
        .toList();
    activeUsers.forEach(u => Logger.log(`   ${u.name} → ${u.score}pts`, "Demo"));

    Logger.info("LINQ — score between 50 and 80:", "Demo");
    const midRange = await ctx.users
        .where(q => q.between("score", 50 as never, 80 as never))
        .toList();
    midRange.forEach(u => Logger.log(`   ${u.name} → ${u.score}pts`, "Demo"));

    Logger.info("LINQ — name IN [Alice, Dana]:", "Demo");
    const byName = await ctx.users
        .where(q => q.in("name", ["Alice", "Dana"]))
        .toList();
    byName.forEach(u => Logger.log(`   ${u.name}`, "Demo"));

    // ── Terminal methods ──────────────────────────────────────────────────────

    Logger.info("first() — top scorer:", "Demo");
    const top = await ctx.users.orderByDescending("score").first();
    Logger.log(`   ${top.name} with ${top.score} points`, "Demo");

    Logger.info("firstOrDefault() — 'Ghost' (not found):", "Demo");
    const ghost = await ctx.users.where(q => q.eq("name", "Ghost")).firstOrDefault();
    Logger.log(`   ${ghost ?? "null (not found)"}`, "Demo");

    Logger.info("single() — unique email:", "Demo");
    const alice2 = await ctx.users.where(q => q.eq("email", "alice@punk.com")).single();
    Logger.log(`   Found: ${alice2.name}`, "Demo");

    // ── Aggregates ────────────────────────────────────────────────────────────

    Logger.info("Aggregates:", "Demo");
    Logger.log(`   count: ${await ctx.users.count()}`, "Demo");
    Logger.log(`   active: ${await ctx.users.where(q => q.eq("active", true as never)).count()}`, "Demo");
    Logger.log(`   sum(score): ${await ctx.users.sum("score")}`, "Demo");
    Logger.log(`   max(score): ${await ctx.users.max("score")}`, "Demo");
    Logger.log(`   min(score): ${await ctx.users.min("score")}`, "Demo");
    Logger.log(`   avg(score): ${(await ctx.users.average("score")).toFixed(1)}`, "Demo");
    Logger.log(`   any(score > 80): ${await ctx.users.any(q => q.gt("score", 80 as never))}`, "Demo");

    // ── Projection ────────────────────────────────────────────────────────────

    Logger.info("select() projection:", "Demo");
    const labels = await ctx.users
        .where(q => q.eq("active", true as never))
        .orderBy("name")
        .select(u => ({ label: `${u.name} (${u.score}pts)` }))
        .toList();
    labels.forEach(l => Logger.log(`   ${l.label}`, "Demo"));

    // ── Posts & relations ─────────────────────────────────────────────────────

    Logger.info("Creating posts...", "Demo");
    const fetchedAlice = await ctx.users.where(q => q.eq("email", "alice@punk.com")).single();
    ctx.posts.add(ctx.posts.create({ title: "Hello PunkORM", body: "It works!", views: 150, authorId: fetchedAlice.id }));
    ctx.posts.add(ctx.posts.create({ title: "Bun is 🔥", body: null, views: 350, authorId: fetchedAlice.id }));
    await ctx.posts.saveChanges();

    const topPost = await ctx.posts.orderByDescending("views").first();
    Logger.log(`Top post: "${topPost.title}" — ${topPost.views} views`, "Demo");

    // ── Pagination ────────────────────────────────────────────────────────────

    const page1 = await ctx.users.orderBy("name").take(2).toList();
    const page2 = await ctx.users.orderBy("name").skip(2).take(2).toList();
    Logger.log(`📄 Page 1: ${page1.map(u => u.name).join(", ")}`, "Demo");
    Logger.log(`   Page 2: ${page2.map(u => u.name).join(", ")}`, "Demo");

    ctx.close();
    Logger.success("PunkORM demo complete!", "Demo");
}

main().catch(err => Logger.error(err instanceof Error ? err.message : String(err), "Demo"));
