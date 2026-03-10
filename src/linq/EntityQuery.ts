import type { IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";
import { WhereExpression } from "./WhereExpression.ts";

type Constructor<T> = new (...args: Array<unknown>) => T;
type OrderDir = "ASC" | "DESC";
type StringKeys<T> = Extract<keyof T, string>;
type WhereFn<T> = (q: WhereExpression<T>) => WhereExpression<T>;

interface OrderClause {
    field: string;
    dir: OrderDir;
}

interface StoredWhere {
    sql: string;
    params: Array<unknown>;
}

/**
 * Lazy, fluent LINQ-style query chain for a single entity type.
 *
 * Queries are **not executed** until a terminal method is called.
 *
 * @example
 * // Chained query
 * const users = await ctx.users
 *   .where(q => q.eq("active", true).and(q => q.contains("name", "Al")))
 *   .orderBy("name")
 *   .skip(0)
 *   .take(10)
 *   .toList();
 *
 * // Aggregates
 * const n = await ctx.users.where(q => q.eq("active", true)).count();
 * const max = await ctx.posts.max("views");
 */
export class EntityQuery<T extends object> {
    private _wheres: Array<StoredWhere> = [];
    private _orders: Array<OrderClause> = [];
    private _limit?: number;
    private _offset?: number;
    private _selectedColumns: Array<string> = ["*"];
    private _hydrate: (row: Record<string, unknown>) => T;

    public constructor(
        private readonly db: IDatabaseAdapter,
        private readonly tableName: string,
        hydrate: (row: Record<string, unknown>) => T,
        private readonly EntityClass?: Constructor<T>
    ) {
        this._hydrate = hydrate;
    }

    // ── Fluent (lazy) methods ──────────────────────────────────────────────────

    public where(fn: WhereFn<T>): this {
        const expr = new WhereExpression<T>(this.db);
        fn(expr);
        const { sql, params } = expr.build();
        if (sql) this._wheres.push({ sql, params });
        return this;
    }

    public orderBy(field: StringKeys<T>, dir: OrderDir = "ASC"): this {
        this._orders.push({ field, dir });
        return this;
    }

    public orderByDescending(field: StringKeys<T>): this {
        return this.orderBy(field, "DESC");
    }

    public thenBy(field: StringKeys<T>, dir: OrderDir = "ASC"): this {
        return this.orderBy(field, dir);
    }

    public thenByDescending(field: StringKeys<T>): this {
        return this.orderBy(field, "DESC");
    }

    public skip(n: number): this {
        this._offset = n;
        return this;
    }

    public take(n: number): this {
        this._limit = n;
        return this;
    }

    /**
     * Project specific columns.
     * If a mapper function is provided, we attempt to detect which columns are needed.
     * Note: At runtime, we extract keys from the object returned by the mapper
     * using a proxy or a dummy instance.
     */
    public select<U extends Record<string, unknown>>(mapper: (entity: T) => U): EntityQuery<U> {
        // To detect columns at runtime without executing the query first:
        // We create a proxy that tracks accessed properties.
        const accessedColumns = new Set<string>();
        const proxy = new Proxy({} as T, {
            get: (_, prop) => {
                if (typeof prop === "string") accessedColumns.add(prop);
                return undefined;
            }
        });

        try {
            mapper(proxy);
        } catch {
            // If mapper fails (e.g. tries to access nested stuff or calls methods),
            // we fall back to * or keep previous.
        }

        const projectColumns = accessedColumns.size > 0 ? Array.from(accessedColumns) : ["*"];

        const cloneHydrate = (row: Record<string, unknown>): U => mapper(this._hydrate(row));

        const clone = new EntityQuery<U>(this.db, this.tableName, cloneHydrate);

        // Copy accumulated state
        clone["_wheres"] = [...this._wheres];
        clone["_orders"] = [...this._orders];
        clone["_limit"] = this._limit;
        clone["_offset"] = this._offset;
        clone["_selectedColumns"] = projectColumns;

        return clone;
    }

    // ── Terminal methods ───────────────────────────────────────────────────────

    public async toList(): Promise<Array<T>> {
        const rows = await this.executeSelect();
        return rows.map((r) => this._hydrate(r));
    }

    public async toArray(): Promise<Array<T>> {
        return this.toList();
    }

    public async firstOrDefault(): Promise<T | null> {
        const original = this._limit;
        this._limit = 1;
        const results = await this.toList();
        this._limit = original;
        return results[0] ?? null;
    }

    public async first(): Promise<T> {
        const result = await this.firstOrDefault();
        if (result === null) {
            throw new Error(`Sequence contains no elements. Table: "${this.tableName}"`);
        }
        return result;
    }

    public async singleOrDefault(): Promise<T | null> {
        const original = this._limit;
        this._limit = 2;
        const results = await this.toList();
        this._limit = original;

        if (results.length > 1) {
            throw new Error(`Sequence contains more than one element. Table: "${this.tableName}"`);
        }
        return results[0] ?? null;
    }

    public async single(): Promise<T> {
        const result = await this.singleOrDefault();
        if (result === null) {
            throw new Error(`Sequence contains no elements. Table: "${this.tableName}"`);
        }
        return result;
    }

    // ── Aggregates ─────────────────────────────────────────────────────────────

    public async count(): Promise<number> {
        const { sql, params } = this.buildSQL("COUNT(*) as n");
        const rows = await this.db.query<{ n: number }>(sql, params);
        return rows[0]?.n ?? 0;
    }

    public async any(fn?: WhereFn<T>): Promise<boolean> {
        const q = fn ? this.clone().where(fn) : this;
        const n = await q.count();
        return n > 0;
    }

    public async sum(field: StringKeys<T>): Promise<number> {
        const { sql, params } = this.buildSQL(`SUM(${this.db.quote(field)}) as n`);
        const rows = await this.db.query<{ n: number }>(sql, params);
        return rows[0]?.n ?? 0;
    }

    public async min(field: StringKeys<T>): Promise<number> {
        const { sql, params } = this.buildSQL(`MIN(${this.db.quote(field)}) as n`);
        const rows = await this.db.query<{ n: number }>(sql, params);
        return rows[0]?.n ?? 0;
    }

    public async max(field: StringKeys<T>): Promise<number> {
        const { sql, params } = this.buildSQL(`MAX(${this.db.quote(field)}) as n`);
        const rows = await this.db.query<{ n: number }>(sql, params);
        return rows[0]?.n ?? 0;
    }

    public async average(field: StringKeys<T>): Promise<number> {
        const { sql, params } = this.buildSQL(`AVG(${this.db.quote(field)}) as n`);
        const rows = await this.db.query<{ n: number }>(sql, params);
        return rows[0]?.n ?? 0;
    }

    // ── SQL generation ─────────────────────────────────────────────────────────

    private async executeSelect(): Promise<Array<Record<string, unknown>>> {
        const selectExpr = this._selectedColumns
            .map((c) => (c === "*" ? c : this.db.quote(c)))
            .join(", ");
        const { sql, params } = this.buildSQL(selectExpr);
        return this.db.query<Record<string, unknown>>(sql, params);
    }

    private buildSQL(selectExpr: string): { sql: string; params: Array<unknown> } {
        const params: Array<unknown> = [];
        let sql = `SELECT ${selectExpr} FROM ${this.db.quote(this.tableName)}`;

        if (this._wheres.length > 0) {
            const parts = this._wheres.map((w) => {
                params.push(...w.params);
                return `(${w.sql})`;
            });
            sql += ` WHERE ${parts.join(" AND ")}`;
        }

        // Only add ORDER BY for set-returning queries or explicitly requested
        if (this._orders.length > 0) {
            const orderParts = this._orders.map((o) => `${this.db.quote(o.field)} ${o.dir}`);
            sql += ` ORDER BY ${orderParts.join(", ")}`;
        }

        if (this._limit !== undefined) sql += ` LIMIT ${this._limit}`;
        if (this._offset !== undefined) sql += ` OFFSET ${this._offset}`;

        return { sql, params };
    }

    private clone(): EntityQuery<T> {
        const q = new EntityQuery<T>(this.db, this.tableName, this._hydrate, this.EntityClass);
        q["_wheres"] = [...this._wheres];
        q["_orders"] = [...this._orders];
        q["_limit"] = this._limit;
        q["_offset"] = this._offset;
        q["_selectedColumns"] = [...this._selectedColumns];
        return q;
    }
}
