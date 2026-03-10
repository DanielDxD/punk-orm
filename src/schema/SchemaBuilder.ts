import type { IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";
import type { ColumnMetadata, EntityMetadata } from "../metadata/EntityMetadata.ts";

/**
 * Reads entity metadata and generates CREATE TABLE DDL for SQLite.
 */
export class SchemaBuilder {
    public constructor(private readonly db: IDatabaseAdapter) {}

    public async createTable(meta: EntityMetadata): Promise<void> {
        await this.db.run(this.buildCreateTableSql(meta));
    }

    public buildCreateTableSql(meta: EntityMetadata): string {
        const columnDefs = meta.columns.map((col) => this.buildColumnDef(col));

        switch (this.db.dialect) {
            case "mssql":
                return `IF OBJECT_ID('${meta.tableName}', 'U') IS NULL\nCREATE TABLE ${this.db.quote(
                    meta.tableName
                )} (\n  ${columnDefs.join(",\n  ")}\n);`;
            case "postgres":
            case "mysql":
            case "sqlite":
            default:
                return `CREATE TABLE IF NOT EXISTS ${this.db.quote(
                    meta.tableName
                )} (\n  ${columnDefs.join(",\n  ")}\n);`;
        }
    }

    public buildDropTableSql(meta: EntityMetadata | string): string {
        const tableName = typeof meta === "string" ? meta : meta.tableName;
        switch (this.db.dialect) {
            case "mssql":
                return `IF OBJECT_ID('${tableName}', 'U') IS NOT NULL DROP TABLE ${this.db.quote(
                    tableName
                )};`;
            default:
                return `DROP TABLE IF EXISTS ${this.db.quote(tableName)};`;
        }
    }

    public buildColumnDef(col: ColumnMetadata): string {
        const type = this.getDialectType(col);
        let def: string;

        def = `${this.db.quote(col.columnName)} ${type}`;

        // Handle Identity/Auto-increment
        if (col.isGenerated && col.generationStrategy === "increment") {
            switch (this.db.dialect) {
                case "sqlite":
                    if (col.isPrimary)
                        return `${this.db.quote(col.columnName)} INTEGER PRIMARY KEY AUTOINCREMENT`;
                    break;
                case "postgres":
                    return `${this.db.quote(col.columnName)} SERIAL PRIMARY KEY`;
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
