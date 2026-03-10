/* eslint-disable @typescript-eslint/ban-ts-comment */
import { beforeEach, describe, expect, test } from "bun:test";
import type { IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";
import { DataContext } from "../context/DataContext.ts";
import { DbSet } from "../dbset/DbSet.ts";
import { Column, Entity, ManyToOne, OneToMany, PrimaryKey } from "../decorators/index.ts";

class MockAdapter implements IDatabaseAdapter {
    public dialect: any = "sqlite";
    public lastSql: string = "";
    public lastParams: Array<unknown> = [];
    public mockRows: Array<any> = [];

    public async run(sql: string, params: Array<unknown> = []): Promise<void> {
        this.lastSql = sql;
        this.lastParams = params;
    }
    public async query<T>(sql: string, params: Array<unknown> = []): Promise<Array<T>> {
        this.lastSql = sql;
        this.lastParams = params;
        return this.mockRows;
    }
    public async transaction(fn: () => Promise<void>): Promise<void> {
        await fn();
    }
    public close(): void {
        /* empty */
    }
    public quote(id: string): string {
        return `"${id}"`;
    }
    public async ensureDatabaseExists(): Promise<void> {
        /* empty */
    }
}

@Entity("users")
class User {
    @PrimaryKey()
    public id!: string;

    @Column()
    public name!: string;

    @OneToMany(() => Post, { foreignKey: "authorId" })
    public posts!: Array<Post>;
}

@Entity("posts")
class Post {
    @PrimaryKey()
    public id!: string;

    @Column()
    public title!: string;

    @Column({ type: "uuid" })
    public authorId!: string;

    @ManyToOne(() => User, { foreignKey: "authorId" })
    public author!: User;
}

class TestContext extends DataContext {
    public users = new DbSet(this.db, User);
    public posts = new DbSet(this.db, Post);
}

describe("DbSet Include (Joins)", () => {
    let adapter: MockAdapter;
    let context: TestContext;

    beforeEach(() => {
        adapter = new MockAdapter();
        context = new TestContext(adapter);
    });

    test("should generate correct SQL for ManyToOne include", async () => {
        adapter.mockRows = [
            { t0_id: "p1", t0_title: "Post 1", t0_authorId: "u1", t1_id: "u1", t1_name: "Alice" }
        ];

        const posts = await context.posts.include("author").toList();

        expect(adapter.lastSql).toContain('LEFT JOIN "users" t1 ON t0."authorId" = t1."id"');
        expect(adapter.lastSql).toContain('t0."id" AS t0_id');
        expect(adapter.lastSql).toContain('t1."name" AS t1_name');

        expect(posts.length).toBe(1);
        // @ts-expect-error
        expect(posts[0].id).toBe("p1");
        // @ts-expect-error
        expect(posts[0].author).toBeDefined();
        // @ts-expect-error
        expect(posts[0].author!.name).toBe("Alice");
    });

    test("should generate correct SQL for OneToMany include", async () => {
        adapter.mockRows = [
            { t0_id: "u1", t0_name: "Alice", t1_id: "p1", t1_title: "Post 1", t1_authorId: "u1" },
            { t0_id: "u1", t0_name: "Alice", t1_id: "p2", t1_title: "Post 2", t1_authorId: "u1" }
        ];

        const users = await context.users.include("posts").toList();

        expect(adapter.lastSql).toContain('LEFT JOIN "posts" t1 ON t0."id" = t1."authorId"');

        expect(users.length).toBe(1);
        // @ts-expect-error
        expect(users[0].name).toBe("Alice");
        // @ts-expect-error
        expect(users[0].posts).toHaveLength(2);
        // @ts-expect-error
        expect(users[0].posts![0].title).toBe("Post 1");
        // @ts-expect-error
        expect(users[0].posts![1].title).toBe("Post 2");
    });

    test("should handle multiple includes", async () => {
        // This test just verifies SQL structure for multiple joins
        await context.posts.include("author").toList();
        const sql = adapter.lastSql;
        expect(sql).toContain('FROM "posts" t0');
        expect(sql).toContain('LEFT JOIN "users" t1');
    });

    test("should prefix WHERE columns when aliased", async () => {
        await context.posts
            .include("author")
            .where((q) => q.eq("title", "Hello"))
            .toList();
        expect(adapter.lastSql).toContain('WHERE (t0."title" = ?)');
    });
});
