/**
 * PunkORM — App Entities
 *
 * This file declares entities that will be used by the app context
 * and registered in MetadataStorage for migrations.
 */
import "reflect-metadata";
import {
    Column,
    DataContext,
    Entity,
    ManyToOne,
    OneToMany,
    PostgresAdapter,
    PrimaryGeneratedColumn
} from "./index.ts";
import { Logger } from "./utils/logger.ts";

// ── Entities ──────────────────────────────────────────────────────────────────

@Entity("users")
export class User {
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
export class Post {
    @PrimaryGeneratedColumn("uuid")
    public id: string;

    @Column({ type: "text" })
    public title: string;

    @Column({ type: "text", nullable: true })
    public body: string | null;

    @Column({ type: "integer", default: 0 })
    public views: number;

    @Column({ type: "uuid" })
    public authorId: string;

    @ManyToOne(() => User, { foreignKey: "authorId" })
    public author: User;
}

// ── DataContext ───────────────────────────────────────────────────────────────

export class AppContext extends DataContext {
    public users = this.set(User);
    public posts = this.set(Post);
}

async function demo() {
    const context = new AppContext(
        new PostgresAdapter("postgres://postgres:postgres@localhost:5432/test"),
        {
            autoMigrations: false,
            logging: ["info", "query", "schema"]
        }
    );

    const user = await context.users
        .where((c) => c.eq("email", "example@example.com"))
        .firstOrDefault();

    context.close();

    console.log(user);
}

if (import.meta.main) {
    demo().catch((err) => Logger.error(err instanceof Error ? err.message : String(err), "Main"));
}
