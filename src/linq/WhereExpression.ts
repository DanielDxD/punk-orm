import type { IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";

type StringKeys<T> = Extract<keyof T, string>;
type WhereBuilderFn<T> = (q: WhereExpression<T>) => WhereExpression<T>;

interface WhereClause {
    sql: string;
    params: Array<unknown>;
    connector: "AND" | "OR";
}

/** Internal result of building a where expression */
export interface WhereResult {
    sql: string;
    params: Array<unknown>;
}

/**
 * Type-safe LINQ-style where expression builder.
 *
 * Chain comparison methods to build complex SQL WHERE clauses without
 * writing raw SQL strings.
 *
 * @example
 * // Simple equality
 * q.eq("name", "Alice")
 *
 * // Compound: active users named Alice OR with views > 100
 * q.eq("active", true)
 *  .and(q => q.contains("name", "Alice").or(q => q.gt("views", 100)))
 */
export class WhereExpression<T> {
    private clauses: Array<WhereClause> = [];

    public constructor(private readonly db: IDatabaseAdapter) {}

    // ── Comparison operators ───────────────────────────────────────────────────

    public eq<K extends StringKeys<T>>(field: K, value: T[K]): this {
        return this.push(`${this.db.quote(field)} = ?`, [value]);
    }

    public neq<K extends StringKeys<T>>(field: K, value: T[K]): this {
        return this.push(`${this.db.quote(field)} != ?`, [value]);
    }

    public gt<K extends StringKeys<T>>(field: K, value: T[K]): this {
        return this.push(`${this.db.quote(field)} > ?`, [value]);
    }

    public gte<K extends StringKeys<T>>(field: K, value: T[K]): this {
        return this.push(`${this.db.quote(field)} >= ?`, [value]);
    }

    public lt<K extends StringKeys<T>>(field: K, value: T[K]): this {
        return this.push(`${this.db.quote(field)} < ?`, [value]);
    }

    public lte<K extends StringKeys<T>>(field: K, value: T[K]): this {
        return this.push(`${this.db.quote(field)} <= ?`, [value]);
    }

    // ── String operators ───────────────────────────────────────────────────────

    public contains<K extends StringKeys<T>>(field: K, value: string): this {
        return this.push(`${this.db.quote(field)} LIKE ?`, [`%${value}%`]);
    }

    public startsWith<K extends StringKeys<T>>(field: K, value: string): this {
        return this.push(`${this.db.quote(field)} LIKE ?`, [`${value}%`]);
    }

    public endsWith<K extends StringKeys<T>>(field: K, value: string): this {
        return this.push(`${this.db.quote(field)} LIKE ?`, [`%${value}`]);
    }

    // ── Null checks ────────────────────────────────────────────────────────────

    public isNull<K extends StringKeys<T>>(field: K): this {
        return this.push(`${this.db.quote(field)} IS NULL`, []);
    }

    public isNotNull<K extends StringKeys<T>>(field: K): this {
        return this.push(`${this.db.quote(field)} IS NOT NULL`, []);
    }

    // ── Set operators ──────────────────────────────────────────────────────────

    public in<K extends StringKeys<T>>(field: K, values: Array<T[K]>): this {
        if (values.length === 0) return this.push("1 = 0", []);
        const placeholders = values.map(() => "?").join(", ");
        return this.push(`${this.db.quote(field)} IN (${placeholders})`, values as Array<unknown>);
    }

    public notIn<K extends StringKeys<T>>(field: K, values: Array<T[K]>): this {
        if (values.length === 0) return this;
        const placeholders = values.map(() => "?").join(", ");
        return this.push(
            `${this.db.quote(field)} NOT IN (${placeholders})`,
            values as Array<unknown>
        );
    }

    // ── Range ──────────────────────────────────────────────────────────────────

    public between<K extends StringKeys<T>>(field: K, min: T[K], max: T[K]): this {
        return this.push(`${this.db.quote(field)} BETWEEN ? AND ?`, [min, max]);
    }

    // ── Logical combinators ────────────────────────────────────────────────────

    public and(fn: WhereBuilderFn<T>): this {
        const inner = new WhereExpression<T>(this.db);
        fn(inner);
        const { sql, params } = inner.build();
        if (sql) this.clauses.push({ sql: `(${sql})`, params, connector: "AND" });
        return this;
    }

    public or(fn: WhereBuilderFn<T>): this {
        const inner = new WhereExpression<T>(this.db);
        fn(inner);
        const { sql, params } = inner.build();
        if (sql) this.clauses.push({ sql: `(${sql})`, params, connector: "OR" });
        return this;
    }

    // ── Build ──────────────────────────────────────────────────────────────────

    public build(): WhereResult {
        if (this.clauses.length === 0) return { sql: "", params: [] };

        const params: Array<unknown> = [];
        const parts = this.clauses.map((c, i) => {
            params.push(...c.params);
            return i === 0 ? c.sql : `${c.connector} ${c.sql}`;
        });

        return { sql: parts.join(" "), params };
    }

    // ── Internals ──────────────────────────────────────────────────────────────

    private push(sql: string, params: Array<unknown>, connector: "AND" | "OR" = "AND"): this {
        this.clauses.push({ sql, params, connector });
        return this;
    }
}
