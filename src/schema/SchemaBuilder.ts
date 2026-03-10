import type { IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";
import type { ColumnMetadata, EntityMetadata } from "../metadata/EntityMetadata.ts";

/**
 * Reads entity metadata and generates CREATE TABLE DDL for SQLite.
 */
export class SchemaBuilder {
    public constructor(private readonly db: IDatabaseAdapter) {}

    public async createTable(meta: EntityMetadata): Promise<void> {
        const columnDefs = meta.columns.map((col) => this.buildColumnDef(col));
        let sql: string;

        switch (this.db.dialect) {
            case "postgres":
                sql = `CREATE TABLE IF NOT EXISTS "${meta.tableName}" (\n  ${columnDefs.join(",\n  ")}\n);`;
                break;
            case "mysql":
                sql = `CREATE TABLE IF NOT EXISTS \`${meta.tableName}\` (\n  ${columnDefs.join(",\n  ")}\n);`;
                break;
            case "mssql":
                sql = `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='${meta.tableName}' AND xtype='U')\nCREATE TABLE [${meta.tableName}] (\n  ${columnDefs.join(",\n  ")}\n);`;
                break;
            case "sqlite":
            default:
                sql = `CREATE TABLE IF NOT EXISTS ${meta.tableName} (\n  ${columnDefs.join(",\n  ")}\n);`;
                break;
        }
        await this.db.run(sql);
    }

    public buildColumnDef(col: ColumnMetadata): string {
        const type = this.getDialectType(col);
        let def: string;

        const quote = (s: string) => {
            if (this.db.dialect === "postgres") return `"${s}"`;
            if (this.db.dialect === "mysql") return `\`${s}\``;
            if (this.db.dialect === "mssql") return `[${s}]`;
            return s;
        };

        def = `${quote(col.columnName)} ${type}`;

        // Handle Identity/Auto-increment
        if (col.isGenerated && col.generationStrategy === "increment") {
            switch (this.db.dialect) {
                case "sqlite":
                    if (col.isPrimary)
                        return `${quote(col.columnName)} INTEGER PRIMARY KEY AUTOINCREMENT`;
                    break;
                case "postgres":
                    return `${quote(col.columnName)} SERIAL PRIMARY KEY`;
                case "mysql":
                    def += " AUTO_INCREMENT";
                    break;
                case "mssql":
                    def += " IDENTITY(1,1)";
                    break;
            }
        }

        if (col.isPrimary) def += " PRIMARY KEY";
        if (!col.nullable && !col.isPrimary) def += " NOT NULL";
        if (col.unique && !col.isPrimary) def += " UNIQUE";

        if (col.default !== undefined) {
            const defaultVal = typeof col.default === "string" ? `'${col.default}'` : col.default;
            def += ` DEFAULT ${defaultVal}`;
        }

        return def;
    }

    private getDialectType(col: ColumnMetadata): string {
        switch (this.db.dialect) {
            case "postgres":
                return this.toPostgresType(col);
            case "mysql":
                return this.toMySqlType(col);
            case "mssql":
                return this.toMsSqlType(col);
            case "sqlite":
            default:
                return this.toSQLiteType(col);
        }
    }

    private toPostgresType(col: ColumnMetadata): string {
        switch (col.type) {
            case "integer":
                return "INTEGER";
            case "real":
                return "DOUBLE PRECISION";
            case "boolean":
                return "BOOLEAN";
            case "datetime":
                return "TIMESTAMP";
            case "uuid":
                return "UUID";
            case "blob":
                return "BYTEA";
            case "text":
            default:
                return "TEXT";
        }
    }

    private toMySqlType(col: ColumnMetadata): string {
        switch (col.type) {
            case "integer":
                return "INT";
            case "real":
                return "DOUBLE";
            case "boolean":
                return "TINYINT(1)";
            case "datetime":
                return "DATETIME";
            case "uuid":
                return "VARCHAR(36)";
            case "blob":
                return "LONGBLOB";
            case "text":
            default:
                return "TEXT";
        }
    }

    private toMsSqlType(col: ColumnMetadata): string {
        switch (col.type) {
            case "integer":
                return "INT";
            case "real":
                return "FLOAT";
            case "boolean":
                return "BIT";
            case "datetime":
                return "DATETIME2";
            case "uuid":
                return "UNIQUEIDENTIFIER";
            case "blob":
                return "VARBINARY(MAX)";
            case "text":
            default:
                return "NVARCHAR(MAX)";
        }
    }

    private toSQLiteType(col: ColumnMetadata): string {
        switch (col.type) {
            case "integer":
                return "INTEGER";
            case "real":
                return "REAL";
            case "blob":
                return "BLOB";
            case "boolean":
                return "INTEGER"; // SQLite stores booleans as 0/1
            case "datetime":
                return "TEXT"; // ISO-8601 strings
            case "uuid":
                return "TEXT";
            case "text":
            default:
                return "TEXT";
        }
    }
}
