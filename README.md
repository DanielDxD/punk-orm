# 🎸 PunkORM

> An Entity Framework-inspired ORM for **Bun** — supporting **SQLite, PostgreSQL, MySQL/MariaDB, and MSSQL** with decorators, `DataContext`, `DbSet<T>` and a fluent LINQ-like query builder.

---

## Installation

```bash
bun add @danielgl/punk-orm reflect-metadata
# Install your driver:
# bun add postgres      # for PostgreSQL
# bun add mysql2        # for MySQL/MariaDB
# bun add mssql         # for MSSQL
```

Add to your `tsconfig.json`:

```json
{
    "compilerOptions": {
        "experimentalDecorators": true,
        "emitDecoratorMetadata": true
    }
}
```

---

## 🗄️ Supported Databases

PunkORM supports multiple database engines. Choose the appropriate adapter for your project:

### SQLite

Uses Bun's native `bun:sqlite` driver. No external dependencies required.

```ts
import { BunSQLiteAdapter } from "@danielgl/punk-orm";
const adapter = new BunSQLiteAdapter("./app.db");
```

### PostgreSQL

Requires `postgres` (postgres.js).

```ts
import { PostgresAdapter } from "@danielgl/punk-orm";
// URL Format: postgres://user:password@host:port/database
const adapter = new PostgresAdapter("postgres://postgres:pass@localhost:5432/mydb");
```

### MySQL / MariaDB

Requires `mysql2`.

```ts
import { MySqlAdapter } from "@danielgl/punk-orm";
// URL Format: mysql://user:password@host:port/database
const adapter = new MySqlAdapter("mysql://root:pass@localhost:3306/mydb");
```

### MSSQL (SQL Server)

Requires `mssql` (tedious). Supports both URL and traditional connection strings.

```ts
import { MsSqlAdapter } from "@danielgl/punk-orm";

// 1. URL Format (Recommended)
// mssql://user:password@host:port/database
const adapter1 = new MsSqlAdapter("mssql://sa:password@localhost/master");

// 2. Traditional Connection String
const adapter2 = new MsSqlAdapter(
    "Server=localhost;Database=master;User Id=sa;Password=password;TrustServerCertificate=True;"
);
```

> [!TIP]
> **Special Characters**: Connection strings now robustly handle passwords containing `@`, `#`, or other special characters without needing manual URL encoding.

---

## Quick Start

### 1. Define Entities

```ts
import "reflect-metadata";
import { Entity, Column, PrimaryGeneratedColumn, OneToMany, ManyToOne } from "@danielgl/punk-orm";

@Entity("users")
class User {
    @PrimaryGeneratedColumn("uuid")
    public id: string;

    @Column({ type: "text" })
    public name: string;

    @Column({ type: "text", unique: true })
    public email: string;

    @OneToMany(() => Post, { foreignKey: "authorId" })
    public posts: Post[];
}

@Entity("posts")
class Post {
    @PrimaryGeneratedColumn("uuid")
    public id: string;

    @Column({ type: "text" })
    public title: string;

    @Column({ type: "integer", default: 0 })
    public views: number;

    @Column({ type: "text" })
    public authorId: string;

    @ManyToOne(() => User)
    public author: User;
}
```

### 2. Create a DataContext

```ts
import { DataContext, BunSQLiteAdapter, PostgresAdapter } from "@danielgl/punk-orm";

class AppContext extends DataContext {
    users = this.set(User);
    posts = this.set(Post);

    // Optional: Seed data or configure models
    protected onModelCreating(): void {
        console.log("Configuring models...");
    }
}

// Use SQLite
const ctx = new AppContext(new BunSQLiteAdapter("./app.db"), {
    logging: ["query", "error"],
    autoMigrations: true
});

// Or PostgreSQL
// const ctx = new AppContext(new PostgresAdapter("postgres://user:pass@localhost:5432/db"));

await ctx.initialize();
```

### 3. CRUD via DbSet

```ts
// INSERT
const user = ctx.users.create({ name: "Alice", email: "alice@example.com" });
ctx.users.add(user);
await ctx.users.saveChanges();

// SELECT
const all = await ctx.users.find();
const alice = await ctx.users.findOneOrFail({ email: "alice@example.com" });

// UPDATE
alice.name = "Alice Smith";
ctx.users.update(alice);
await ctx.users.saveChanges();

// DELETE
ctx.users.remove(alice);
await ctx.users.saveChanges();
```

### 4. Fluent Query Builder (LINQ-inspired)

```ts
// Eager Loading (Joins)
const postsWithAuthor = await ctx.posts
    .include("author")
    .where((p) => p.views.gt(100))
    .toList();

// Complex filtering with projections
const topPosts = await ctx.posts
    .asQuery()
    .where((p) => p.views.gt(100).and(p.title.contains("Punk")))
    .orderByDescending((p) => p.views)
    .select((p) => ({ id: p.id, title: p.title })) // Optimized projection
    .take(10)
    .toList();

// Or raw SQL style
const raw = await ctx.posts
    .createQueryBuilder()
    .where("views > ?", [100])
    .orderBy("views", "DESC")
    .getMany();
```

---

## 🛠️ CLI (Punk CLI)

PunkORM comes with a CLI to handle migrations and scaffolding.

```bash
# Initialize project (scaffolds punk.config.ts)
bun punk init

# Generate a migration based on entity changes
bun punk generate migration --name create_users

# Run all pending migrations
bun punk run migration

# Check status
bun punk status
```

---

## API Reference

### Decorators

| Decorator                                        | Description                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `@Entity(name?)`                                 | Maps a class to a SQL table                                                   |
| `@Column(opts?)`                                 | Maps a property to a column. Options: `type`, `nullable`, `unique`, `default` |
| `@PrimaryKey()`                                  | Manual primary key (no auto-generation)                                       |
| `@PrimaryGeneratedColumn("uuid" \| "increment")` | Auto-generated PK                                                             |
| `@OneToMany(() => Entity, { foreignKey })`       | 1-to-N relation                                                               |
| `@ManyToOne(() => Entity, opts?)`                | N-to-1 relation (owns FK)                                                     |

### Column Types

`text` · `integer` · `real` · `blob` · `boolean` · `datetime` · `uuid`

### DataContext

| Method              | Description                                  |
| ------------------- | -------------------------------------------- |
| `initialize()`      | Creates/migrates tables                      |
| `onModelCreating()` | Overridable method for seeding/entity config |
| `set(Entity)`       | Returns `DbSet<T>` for the entity            |
| `adapter`           | Raw database adapter                         |
| `close()`           | Closes the connection                        |

### DbSet\<T\>

| Method                 | Description                                   |
| ---------------------- | --------------------------------------------- |
| `find(opts?)`          | SELECT with optional where/orderBy/skip/take  |
| `findOne(where)`       | Returns first match or `null`                 |
| `findOneOrFail(where)` | Returns first match or throws                 |
| `create(data)`         | Instantiates entity (not persisted)           |
| `add(entity)`          | Stages INSERT                                 |
| `update(entity)`       | Stages UPDATE                                 |
| `remove(entity)`       | Stages DELETE                                 |
| `bulkInsert(entities)` | Immediate high-performance INSERT             |
| `bulkUpdate(entities)` | Immediate high-performance UPDATE (CASE)      |
| `bulkDelete(entities)` | Immediate high-performance DELETE (IN)        |
| `saveChanges()`        | Flushes all staged changes in a transaction   |
| `include(relation)`    | Joins a relation (Eager Loading)              |
| `asQuery()`            | Starts a fluent query chain                   |
| `createQueryBuilder()` | Returns a `QueryBuilder` scoped to this table |

---

## Development

```bash
bun run dev    # run demo
bun test       # run test suite
bun run build  # build to dist/
```
