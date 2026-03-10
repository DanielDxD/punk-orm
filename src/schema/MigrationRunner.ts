import type { IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";
import { metadataStorage } from "../metadata/MetadataStorage.ts";
import { Logger } from "../utils/logger.ts";
import { SchemaBuilder } from "./SchemaBuilder.ts";

interface ColumnInfo {
    name: string;
}

/**
 * Compares current DB schema with entity metadata and applies incremental changes.
 * Currently supports:
 *  - CREATE TABLE IF NOT EXISTS (via SchemaBuilder)
 *  - ALTER TABLE … ADD COLUMN for new columns
 */
export class MigrationRunner {
    private schemaBuilder: SchemaBuilder;

    public constructor(private readonly db: IDatabaseAdapter) {
        this.schemaBuilder = new SchemaBuilder(db);
    }

    public async run(): Promise<void> {
        const entities = metadataStorage.getAllEntities();

        for (const meta of entities) {
            const tableExists = await this.tableExists(meta.tableName);

            if (!tableExists) {
                await this.schemaBuilder.createTable(meta);
                continue;
            }

            const existingColumns = await this.getExistingColumns(meta.tableName);
            const existingNames = new Set(existingColumns.map((c) => c.name));

            for (const col of meta.columns) {
                if (!existingNames.has(col.columnName)) {
                    const colDef = this.schemaBuilder.buildColumnDef({
                        ...col,
                        // ALTER TABLE ADD COLUMN can't have NOT NULL without DEFAULT
                        nullable: col.default === undefined ? true : col.nullable
                    });
                    const sql = `ALTER TABLE ${meta.tableName} ADD COLUMN ${colDef}`;
                    await this.db.run(sql);
                    Logger.info(
                        `Added column "${col.columnName}" to "${meta.tableName}"`,
                        "PunkORM"
                    );
                }
            }
        }
    }

    private async tableExists(tableName: string): Promise<boolean> {
        const rows = await this.db.query<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            [tableName]
        );
        return rows.length > 0;
    }

    private async getExistingColumns(tableName: string): Promise<Array<ColumnInfo>> {
        return this.db.query<ColumnInfo>(`PRAGMA table_info(${tableName})`);
    }
}
