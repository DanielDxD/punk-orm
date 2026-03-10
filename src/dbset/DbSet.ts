import { randomUUIDv7 } from "bun";
import type { IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";
import { EntityQuery } from "../linq/EntityQuery.ts";
import { WhereExpression } from "../linq/WhereExpression.ts";
import { metadataStorage } from "../metadata/MetadataStorage.ts";
import { QueryBuilder } from "../query/QueryBuilder.ts";

type Constructor<T> = new (...args: Array<unknown>) => T;
type WhereFn<T> = (q: WhereExpression<T>) => WhereExpression<T>;
type StringKeys<T> = Extract<keyof T, string>;

export interface FindOptions<T> {
    where?: Partial<Record<keyof T, unknown>>;
    orderBy?: Partial<Record<keyof T, "ASC" | "DESC">>;
    skip?: number;
    take?: number;
}

type PendingOperation<T> =
    | { type: "insert"; entity: T }
    | { type: "update"; entity: T }
    | { type: "delete"; entity: T };

/**
 * Repository-like collection for a single entity type.
 * Changes are staged and committed in a transaction via `saveChanges()`.
 *
 * @example
 * const user = context.users.create({ name: "Alice", email: "alice@example.com" });
 * context.users.add(user);
 * await context.users.saveChanges();
 */
export class DbSet<T extends object> {
    private pending: Array<PendingOperation<T>> = [];
    private entityTarget: Constructor<T>;
    private tableName: string;

    public constructor(
        private readonly db: IDatabaseAdapter,
        entityClass: Constructor<T>
    ) {
        this.entityTarget = entityClass;
        const meta = metadataStorage.getEntity(entityClass as unknown as Constructor<unknown>);
        if (!meta) {
            throw new Error(
                `Entity "${entityClass.name}" is not registered. Did you forget @Entity()?`
            );
        }
        this.tableName = meta.tableName;
    }

    // ── Query ──────────────────────────────────────────────────────────────────

    public async find(options?: FindOptions<T>): Promise<Array<T>> {
        const qb = new QueryBuilder(this.db).from(this.tableName);

        if (options?.where) {
            for (const [key, value] of Object.entries(options.where)) {
                qb.where(`${key} = ?`, [value]);
            }
        }

        if (options?.orderBy) {
            for (const [key, dir] of Object.entries(options.orderBy)) {
                qb.orderBy(key, (dir as "ASC" | "DESC") ?? "ASC");
            }
        }

        if (options?.skip !== undefined) qb.skip(options.skip);
        if (options?.take !== undefined) qb.take(options.take);

        const rows = await qb.getMany<Record<string, unknown>>();
        return rows.map((r) => this.hydrate(r));
    }

    public async findOne(where: Partial<Record<keyof T, unknown>>): Promise<T | null> {
        const results = await this.find({ where, take: 1 });
        return results[0] ?? null;
    }

    public async findOneOrFail(where: Partial<Record<keyof T, unknown>>): Promise<T> {
        const result = await this.findOne(where);
        if (!result) {
            throw new Error(
                `Entity "${this.entityTarget.name}" not found for: ${JSON.stringify(where)}`
            );
        }
        return result;
    }

    /** Build a raw QueryBuilder scoped to this entity's table */
    public createQueryBuilder(): QueryBuilder {
        return new QueryBuilder(this.db).from(this.tableName);
    }

    // ── LINQ entry-points ──────────────────────────────────────────────────────

    public where(fn: WhereFn<T>): EntityQuery<T> {
        return this.asQuery().where(fn);
    }

    public orderBy(field: StringKeys<T>, dir: "ASC" | "DESC" = "ASC"): EntityQuery<T> {
        return this.asQuery().orderBy(field, dir);
    }

    public orderByDescending(field: StringKeys<T>): EntityQuery<T> {
        return this.asQuery().orderByDescending(field);
    }

    public skip(n: number): EntityQuery<T> {
        return this.asQuery().skip(n);
    }

    public take(n: number): EntityQuery<T> {
        return this.asQuery().take(n);
    }

    public async toList(): Promise<Array<T>> {
        return this.asQuery().toList();
    }

    public async count(): Promise<number> {
        return this.asQuery().count();
    }

    public async any(fn?: WhereFn<T>): Promise<boolean> {
        return this.asQuery().any(fn);
    }

    public async firstOrDefault(): Promise<T | null> {
        return this.asQuery().firstOrDefault();
    }

    public async first(): Promise<T> {
        return this.asQuery().first();
    }

    public async singleOrDefault(): Promise<T | null> {
        return this.asQuery().singleOrDefault();
    }

    public async single(): Promise<T> {
        return this.asQuery().single();
    }

    public async sum(field: StringKeys<T>): Promise<number> {
        return this.asQuery().sum(field);
    }

    public async max(field: StringKeys<T>): Promise<number> {
        return this.asQuery().max(field);
    }

    public async min(field: StringKeys<T>): Promise<number> {
        return this.asQuery().min(field);
    }

    public async average(field: StringKeys<T>): Promise<number> {
        return this.asQuery().average(field);
    }

    public asQuery(): EntityQuery<T> {
        return new EntityQuery<T>(
            this.db,
            this.tableName,
            (row) => this.hydrate(row),
            this.entityTarget
        );
    }

    // ── Change tracking ────────────────────────────────────────────────────────

    public create(data: Partial<T>): T {
        const instance = new this.entityTarget() as T;
        Object.assign(instance, data);
        return instance;
    }

    public add(entity: T): void {
        this.pending.push({ type: "insert", entity });
    }

    public update(entity: T): void {
        this.pending.push({ type: "update", entity });
    }

    public remove(entity: T): void {
        this.pending.push({ type: "delete", entity });
    }

    public async saveChanges(): Promise<void> {
        if (this.pending.length === 0) return;

        const ops = [...this.pending];
        this.pending = [];

        await this.db.transaction(async () => {
            for (const op of ops) {
                if (op.type === "insert") await this.executeInsert(op.entity);
                else if (op.type === "update") await this.executeUpdate(op.entity);
                else if (op.type === "delete") await this.executeDelete(op.entity);
            }
        });
    }

    // ── SQL generation ─────────────────────────────────────────────────────────

    private async executeInsert(entity: T): Promise<void> {
        const columns = metadataStorage.getColumns(
            this.entityTarget as unknown as Constructor<unknown>
        );
        const record = entity as Record<string, unknown>;

        const colNames: Array<string> = [];
        const colValues: Array<unknown> = [];

        for (const col of columns) {
            if (col.isGenerated) {
                if (col.generationStrategy === "uuid") {
                    record[col.propertyKey] = randomUUIDv7();
                }
                // increment: SQLite handles it automatically
                if (col.generationStrategy === "increment") continue;
            }

            if (record[col.propertyKey] === undefined && col.default !== undefined) {
                record[col.propertyKey] = col.default;
            }

            colNames.push(col.columnName);
            colValues.push(record[col.propertyKey] ?? null);
        }

        const placeholders = colNames.map(() => "?").join(", ");
        const sql = `INSERT INTO ${this.tableName} (${colNames.join(", ")}) VALUES (${placeholders})`;
        await this.db.run(sql, colValues);
    }

    private async executeUpdate(entity: T): Promise<void> {
        const columns = metadataStorage.getColumns(
            this.entityTarget as unknown as Constructor<unknown>
        );
        const record = entity as Record<string, unknown>;

        const pkCol = columns.find((c) => c.isPrimary);
        if (!pkCol) throw new Error(`Entity "${this.entityTarget.name}" has no primary key.`);

        const setClauses: Array<string> = [];
        const setValues: Array<unknown> = [];

        for (const col of columns) {
            if (col.isPrimary) continue;
            setClauses.push(`${col.columnName} = ?`);
            setValues.push(record[col.propertyKey] ?? null);
        }

        setValues.push(record[pkCol.propertyKey]);
        const sql = `UPDATE ${this.tableName} SET ${setClauses.join(", ")} WHERE ${pkCol.columnName} = ?`;
        await this.db.run(sql, setValues);
    }

    private async executeDelete(entity: T): Promise<void> {
        const columns = metadataStorage.getColumns(
            this.entityTarget as unknown as Constructor<unknown>
        );
        const pkCol = columns.find((c) => c.isPrimary);
        if (!pkCol) throw new Error(`Entity "${this.entityTarget.name}" has no primary key.`);

        const record = entity as Record<string, unknown>;
        const sql = `DELETE FROM ${this.tableName} WHERE ${pkCol.columnName} = ?`;
        await this.db.run(sql, [record[pkCol.propertyKey]]);
    }

    // ── Hydration ──────────────────────────────────────────────────────────────

    private hydrate(row: Record<string, unknown>): T {
        const instance = new this.entityTarget() as T;
        Object.assign(instance, row);
        return instance;
    }
}
