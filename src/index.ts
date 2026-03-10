/**
 * PunkORM — Entity Framework-inspired ORM for Bun + SQLite
 */

// Bootstrap reflect-metadata (must be first)
import "reflect-metadata";

// ── Decorators ──────────────────────────────────────────────────────────────
export {
    Column,
    Entity,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    PrimaryKey
} from "./decorators/index.ts";

export type {
    ColumnOptions,
    EntityOptions,
    GenerationStrategy,
    ManyToOneOptions,
    OneToManyOptions
} from "./decorators/index.ts";

// ── Metadata ──────────────────────────────────────────────────────────────
export type {
    ColumnMetadata,
    ColumnType,
    EntityMetadata,
    RelationMetadata
} from "./metadata/EntityMetadata.ts";
export { metadataStorage } from "./metadata/MetadataStorage.ts";

// ── Core ──────────────────────────────────────────────────────────────────
export { DataContext } from "./context/DataContext.ts";
export { DbSet } from "./dbset/DbSet.ts";
export type { FindOptions } from "./dbset/DbSet.ts";

// ── LINQ ──────────────────────────────────────────────────────────────────
export { EntityQuery } from "./linq/EntityQuery.ts";
export { WhereExpression } from "./linq/WhereExpression.ts";
export type { WhereResult } from "./linq/WhereExpression.ts";

// ── Query (raw SQL builder) ────────────────────────────────────────────────
export { QueryBuilder } from "./query/QueryBuilder.ts";

// ── Schema ────────────────────────────────────────────────────────────────
export { MigrationRunner } from "./schema/MigrationRunner.ts";
export { SchemaBuilder } from "./schema/SchemaBuilder.ts";

// ── Connection ────────────────────────────────────────────────────────────
export { BunSQLiteAdapter } from "./connection/BunSQLiteAdapter.ts";
export type { DatabaseDialect, IDatabaseAdapter } from "./connection/DatabaseAdapter.ts";
export { MsSqlAdapter } from "./connection/MsSqlAdapter.ts";
export { MySqlAdapter } from "./connection/MySqlAdapter.ts";
export { PostgresAdapter } from "./connection/PostgresAdapter.ts";

// ── Migrations ────────────────────────────────────────────────────────────
export { Migration } from "./migrations/Migration.ts";
export { MigrationManager } from "./migrations/MigrationManager.ts";
export { SchemaDiffer } from "./migrations/SchemaDiffer.ts";
export type { GeneratedSQL, SchemaDiff } from "./migrations/SchemaDiffer.ts";
