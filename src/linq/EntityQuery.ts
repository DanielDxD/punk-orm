import type { IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";
import { metadataStorage } from "../metadata/MetadataStorage.ts";
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
    private _includes: Set<string> = new Set();
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

    public include(relation: StringKeys<T>): this {
        this._includes.add(relation);
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

    // ── SQL generation ─────────────────────────────────────────────────────────

    public async toList(): Promise<Array<T>> {
        if (this._includes.size === 0) {
            const rows = await this.executeSelect();
            return rows.map((r: Record<string, unknown>) => this._hydrate(r));
        }

        // Relations case: uses RelationHydrator
        const { sql, params } = this.buildSQL();
        const rows = await this.db.query<Record<string, unknown>>(sql, params);

        const { RelationHydrator } = await import("../query/RelationHydrator.ts");
        return RelationHydrator.hydrate<T>(rows, {
            includes: this._includes,
            rootEntityClass: this.EntityClass!
        });
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

    private async executeSelect(): Promise<Array<Record<string, unknown>>> {
        const { sql, params } = this.buildSQL();
        return this.db.query<Record<string, unknown>>(sql, params);
    }

    private buildSQL(aggregateExpr?: string): { sql: string; params: Array<unknown> } {
        const params: Array<unknown> = [];
        const isAliased = this._includes.size > 0 && !aggregateExpr;
        const mainAlias = isAliased ? "t0" : "";
        const mainMeta = this.EntityClass
            ? metadataStorage.getEntityByTarget(this.EntityClass)
            : null;

        let sql = "SELECT ";

        // 1. Column Selection
        if (aggregateExpr) {
            sql += aggregateExpr;
        } else if (!isAliased) {
            const selectExpr = this._selectedColumns
                .map((c: string) => (c === "*" ? c : this.db.quote(c)))
                .join(", ");
            sql += selectExpr;
        } else {
            // Aliased selection: t0.col as t0_col, t1.col as t1_col...
            const selectParts: Array<string> = [];

            // Main entity columns
            if (mainMeta) {
                for (const col of mainMeta.columns) {
                    selectParts.push(
                        `${mainAlias}.${this.db.quote(col.columnName)} AS ${mainAlias}_${
                            col.propertyKey
                        }`
                    );
                }
            } else {
                // Fallback for non-entity or untracked
                selectParts.push(`${mainAlias}.*`);
            }

            // Included relations columns
            const includes = Array.from(this._includes);
            for (let i = 0; i < includes.length; i++) {
                const relKey = includes[i];
                const alias = `t${i + 1}`;
                const relMeta = mainMeta?.relations.find((r) => r.propertyKey === relKey);
                if (relMeta) {
                    const targetMeta = metadataStorage.getEntityByTarget(relMeta.target());
                    if (targetMeta) {
                        for (const col of targetMeta.columns) {
                            selectParts.push(
                                `${alias}.${this.db.quote(col.columnName)} AS ${alias}_${
                                    col.propertyKey
                                }`
                            );
                        }
                    } else {
                        selectParts.push(`${alias}.*`);
                    }
                }
            }
            sql += selectParts.join(", ");
        }

        sql += ` FROM ${this.db.quote(this.tableName)}${isAliased ? " t0" : ""}`;

        // 2. Joins
        if (isAliased && mainMeta) {
            const includes = Array.from(this._includes);
            for (let i = 0; i < includes.length; i++) {
                const relKey = includes[i];
                const alias = `t${i + 1}`;
                const relMeta = mainMeta.relations.find((r) => r.propertyKey === relKey);
                if (relMeta) {
                    const targetMeta = metadataStorage.getEntityByTarget(relMeta.target());
                    if (targetMeta) {
                        if (relMeta.relationType === "many-to-one") {
                            // User -> Role (authorId -> User.id)
                            // Here relMeta.foreignKey is 'authorId' on Post
                            sql += ` LEFT JOIN ${this.db.quote(targetMeta.tableName)} ${alias} ON t0.${this.db.quote(
                                relMeta.foreignKey
                            )} = ${alias}.${this.db.quote(targetMeta.columns.find((c: any) => c.isPrimary)?.columnName ?? "id")}`;
                        } else {
                            // OneToMany: User -> Posts (User.id -> Post.authorId)
                            // Here relMeta.foreignKey is 'authorId' on Post
                            sql += ` LEFT JOIN ${this.db.quote(targetMeta.tableName)} ${alias} ON t0.${this.db.quote(
                                mainMeta.columns.find((c: any) => c.isPrimary)?.columnName ?? "id"
                            )} = ${alias}.${this.db.quote(relMeta.foreignKey)}`;
                        }
                    }
                }
            }
        }

        // 3. Wheres
        if (this._wheres.length > 0) {
            const parts = this._wheres.map((w) => {
                params.push(...w.params);
                let whereSql = w.sql;
                if (isAliased) {
                    // Primitive support: prefix all columns with t0.
                    // Note: This is a simple regex and might need refinement for complex cases.
                    // We assume valid identifiers are quoted or just plain text.
                    // Since the ORM quotes them, we look for quoted identifiers.
                    // This is naive but works for our current quote implementation.
                    whereSql = whereSql
                        .replace(/`([^`]+)`/g, "t0.`$1`")
                        .replace(/"([^"]+)"/g, 't0."$1"')
                        .replace(/\[([^\]]+)\]/g, "t0.[$1]");
                }
                return `(${whereSql})`;
            });
            sql += ` WHERE ${parts.join(" AND ")}`;
        }

        // 4. Order By
        if (this._orders.length > 0) {
            const orderParts = this._orders.map((o) => {
                const fieldSql = isAliased
                    ? `${mainAlias}.${this.db.quote(o.field)}`
                    : this.db.quote(o.field);
                return `${fieldSql} ${o.dir}`;
            });
            sql += ` ORDER BY ${orderParts.join(", ")}`;
        }

        // 5. Limit / Offset
        if (this._limit !== undefined) {
            if (this.db.dialect === "mssql") {
                if (this._orders.length === 0) sql += " ORDER BY (SELECT NULL)";
                sql += ` OFFSET ${this._offset ?? 0} ROWS FETCH NEXT ${this._limit} ROWS ONLY`;
            } else {
                sql += ` LIMIT ${this._limit}`;
                if (this._offset !== undefined) sql += ` OFFSET ${this._offset}`;
            }
        } else if (this._offset !== undefined) {
            if (this.db.dialect === "mssql") {
                if (this._orders.length === 0) sql += " ORDER BY (SELECT NULL)";
                sql += ` OFFSET ${this._offset} ROWS`;
            } else {
                sql += ` OFFSET ${this._offset}`;
            }
        }

        return { sql, params };
    }

    private clone(): EntityQuery<T> {
        const q = new EntityQuery<T>(this.db, this.tableName, this._hydrate, this.EntityClass);
        q["_wheres"] = [...this._wheres];
        q["_orders"] = [...this._orders];
        q["_limit"] = this._limit;
        q["_offset"] = this._offset;
        q["_selectedColumns"] = [...this._selectedColumns];
        q["_includes"] = new Set(this._includes);
        return q;
    }
}
