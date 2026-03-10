import type { IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";

type OrderDirection = "ASC" | "DESC";

interface JoinClause {
    type: "INNER" | "LEFT";
    table: string;
    on: string;
}

interface WhereClause {
    sql: string;
    params: Array<unknown>;
    connector: "AND" | "OR";
}

/**
 * Fluent SQL query builder.
 *
 * @example
 * const users = await new QueryBuilder(db)
 *   .select(["id", "name", "email"])
 *   .from("users")
 *   .where("active = ?", [1])
 *   .orderBy("name", "ASC")
 *   .take(10)
 *   .getMany<User>();
 */
export class QueryBuilder {
    private _select: Array<string> = ["*"];
    private _from = "";
    private _wheres: Array<WhereClause> = [];
    private _joins: Array<JoinClause> = [];
    private _orderBys: Array<string> = [];
    private _limit?: number;
    private _offset?: number;

    public constructor(private readonly db: IDatabaseAdapter) {}

    // ── SELECT / FROM ──────────────────────────────────────────────────────────

    public select(fields: Array<string>): this {
        this._select = fields;
        return this;
    }

    public from(table: string): this {
        this._from = table;
        return this;
    }

    // ── WHERE ──────────────────────────────────────────────────────────────────

    public where(condition: string, params: Array<unknown> = []): this {
        this._wheres.push({ sql: condition, params, connector: "AND" });
        return this;
    }

    public andWhere(condition: string, params: Array<unknown> = []): this {
        this._wheres.push({ sql: condition, params, connector: "AND" });
        return this;
    }

    public orWhere(condition: string, params: Array<unknown> = []): this {
        this._wheres.push({ sql: condition, params, connector: "OR" });
        return this;
    }

    // ── JOINS ──────────────────────────────────────────────────────────────────

    public innerJoin(table: string, on: string): this {
        this._joins.push({ type: "INNER", table, on });
        return this;
    }

    public leftJoin(table: string, on: string): this {
        this._joins.push({ type: "LEFT", table, on });
        return this;
    }

    // ── ORDER / PAGINATION ─────────────────────────────────────────────────────

    public orderBy(field: string, direction: OrderDirection = "ASC"): this {
        this._orderBys.push(`${field} ${direction}`);
        return this;
    }

    public take(n: number): this {
        this._limit = n;
        return this;
    }

    public skip(n: number): this {
        this._offset = n;
        return this;
    }

    // ── EXECUTION ──────────────────────────────────────────────────────────────

    public async getMany<T = Record<string, unknown>>(): Promise<Array<T>> {
        const { sql, params } = this.buildSelectSQL();
        return this.db.query<T>(sql, params);
    }

    public async getOne<T = Record<string, unknown>>(): Promise<T | null> {
        const original = this._limit;
        this._limit = 1;
        const results = await this.getMany<T>();
        this._limit = original;
        return results[0] ?? null;
    }

    public async getRawMany(): Promise<Array<Record<string, unknown>>> {
        return this.getMany();
    }

    public async execute(sql: string, params: Array<unknown> = []): Promise<void> {
        await this.db.run(sql, params);
    }

    // ── SQL BUILDING ───────────────────────────────────────────────────────────

    public buildSelectSQL(): { sql: string; params: Array<unknown> } {
        const params: Array<unknown> = [];
        const dialect = this.db.dialect;

        const quote = (s: string) => {
            if (dialect === "postgres") return `"${s}"`;
            if (dialect === "mysql") return `\`${s}\``;
            if (dialect === "mssql") return `[${s}]`;
            return s;
        };

        const selectExpr = this._select.map((s) => (s === "*" ? s : quote(s))).join(", ");
        let sql = `SELECT ${selectExpr} FROM ${quote(this._from)}`;

        for (const join of this._joins) {
            sql += ` ${join.type} JOIN ${quote(join.table)} ON ${join.on}`;
        }

        if (this._wheres.length > 0) {
            const whereParts = this._wheres.map((w, i) => {
                params.push(...w.params);
                return i === 0 ? w.sql : `${w.connector} ${w.sql}`;
            });
            sql += ` WHERE ${whereParts.join(" ")}`;
        }

        if (this._orderBys.length > 0) {
            sql += ` ORDER BY ${this._orderBys.join(", ")}`;
        }

        if (this._limit !== undefined) {
            if (dialect === "mssql") {
                // MSSQL OFFSET/FETCH requires ORDER BY
                if (this._orderBys.length === 0) {
                    sql += " ORDER BY (SELECT NULL)";
                }
                sql += ` OFFSET ${this._offset ?? 0} ROWS FETCH NEXT ${this._limit} ROWS ONLY`;
            } else {
                sql += ` LIMIT ${this._limit}`;
                if (this._offset !== undefined) sql += ` OFFSET ${this._offset}`;
            }
        } else if (this._offset !== undefined) {
            if (dialect === "mssql") {
                if (this._orderBys.length === 0) sql += " ORDER BY (SELECT NULL)";
                sql += ` OFFSET ${this._offset} ROWS`;
            } else {
                sql += ` OFFSET ${this._offset}`;
            }
        }

        // Adjust placeholders for Postgres and MSSQL
        if (dialect === "postgres") {
            let i = 1;
            sql = sql.replace(/\?/g, () => `$${i++}`);
        } else if (dialect === "mssql") {
            let i = 1;
            sql = sql.replace(/\?/g, () => `@p${i++}`);
        }

        return { sql, params };
    }
}
