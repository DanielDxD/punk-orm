import type { IDatabaseAdapter } from "../connection/DatabaseAdapter.ts";
import type { ColumnMetadata, EntityMetadata } from "../metadata/EntityMetadata.ts";
import { metadataStorage } from "../metadata/MetadataStorage.ts";
import { SchemaBuilder } from "../schema/SchemaBuilder.ts";

export interface SchemaDiff {
    tablesToCreate: Array<EntityMetadata>;
    columnsToAdd: Array<{ entity: EntityMetadata; column: ColumnMetadata }>;
    /** Columns present in the DB that are no longer in entity metadata */
    columnsToDrop: Array<{ entity: EntityMetadata; columnName: string }>;
}

export interface GeneratedSQL {
    upStatements: Array<string>;
    downStatements: Array<string>;
}

interface ColumnInfo {
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
}

/**
 * Computes the diff between entity metadata and the current live DB schema,
 * then generates the corresponding SQL statements for up() and down().
 */
export class SchemaDiffer {
    private schemaBuilder: SchemaBuilder;

    public constructor(private readonly db: IDatabaseAdapter) {
        this.schemaBuilder = new SchemaBuilder(db);
    }

    /** Compute what needs to change to bring the DB in sync with entity metadata. */
    public async diff(): Promise<SchemaDiff> {
        const entities = metadataStorage.getAllEntities();
        const tablesToCreate: Array<EntityMetadata> = [];
        const columnsToAdd: Array<{ entity: EntityMetadata; column: ColumnMetadata }> = [];
        const columnsToDrop: Array<{ entity: EntityMetadata; columnName: string }> = [];

        for (const meta of entities) {
            const exists = await this.tableExists(meta.tableName);

            if (!exists) {
                tablesToCreate.push(meta);
                continue;
            }

            // Table exists — compare columns in both directions
            const existing = await this.getExistingColumns(meta.tableName);
            const metaColNames = new Set(meta.columns.map((c) => c.columnName));

            // Columns in metadata but not in DB → add
            for (const col of meta.columns) {
                if (!existing.has(col.columnName)) {
                    columnsToAdd.push({ entity: meta, column: col });
                }
            }

            // Columns in DB but not in metadata → drop
            for (const dbColName of existing.keys()) {
                if (!metaColNames.has(dbColName)) {
                    columnsToDrop.push({ entity: meta, columnName: dbColName });
                }
            }
        }

        return { tablesToCreate, columnsToAdd, columnsToDrop };
    }

    /** Convert the diff into SQL strings ready to embed in a migration file. */
    public async generateSQL(): Promise<GeneratedSQL>;
    public async generateSQL(diff: SchemaDiff): Promise<GeneratedSQL>;
    public async generateSQL(diff?: SchemaDiff): Promise<GeneratedSQL> {
        const d = diff ?? (await this.diff());
        const upStatements: Array<string> = [];
        const downStatements: Array<string> = [];

        // ── New tables ──────────────────────────────────────────────────────────
        for (const meta of d.tablesToCreate) {
            const cols = meta.columns.map((c) => this.schemaBuilder.buildColumnDef(c));

            // Append FOREIGN KEY constraints from ManyToOne relations
            const fkLines: Array<string> = [];
            for (const rel of meta.relations) {
                if (rel.relationType === "many-to-one") {
                    const refEntity = metadataStorage
                        .getAllEntities()
                        .find((e) => e.target === rel.target());
                    if (refEntity) {
                        // Find the PK column of the referenced entity
                        const pk = refEntity.columns.find((c) => c.isPrimary);
                        const refCol = pk?.columnName ?? "id";
                        fkLines.push(
                            `FOREIGN KEY (${rel.foreignKey}) REFERENCES ${refEntity.tableName}(${refCol})`
                        );
                    }
                }
            }

            const allDefs = [...cols, ...fkLines];
            const up = `CREATE TABLE IF NOT EXISTS ${meta.tableName} (\n    ${allDefs.join(",\n    ")}\n  )`;
            const down = `DROP TABLE IF EXISTS ${meta.tableName}`;
            upStatements.push(up);
            // Reverse order for down so FK references are dropped first
            downStatements.unshift(down);
        }

        // ── New columns in existing tables ──────────────────────────────────────
        for (const { entity, column } of d.columnsToAdd) {
            const colDef = this.schemaBuilder.buildColumnDef({
                ...column,
                // ALTER TABLE ADD COLUMN cannot be NOT NULL without DEFAULT
                nullable: column.default === undefined ? true : column.nullable
            });
            upStatements.push(`ALTER TABLE ${entity.tableName} ADD COLUMN ${colDef}`);
            downStatements.push(`ALTER TABLE ${entity.tableName} DROP COLUMN ${column.columnName}`);
        }

        // ── Dropped columns ─────────────────────────────────────────────────────
        for (const { entity, columnName } of d.columnsToDrop) {
            upStatements.push(`ALTER TABLE ${entity.tableName} DROP COLUMN ${columnName}`);
            // Best-effort restore as nullable TEXT (type info is lost at this point)
            downStatements.push(`ALTER TABLE ${entity.tableName} ADD COLUMN ${columnName} TEXT`);
        }

        return { upStatements, downStatements };
    }

    /** True if there are no differences (schema is already in sync). */
    public async isInSync(diff?: SchemaDiff): Promise<boolean> {
        const d = diff ?? (await this.diff());
        return (
            d.tablesToCreate.length === 0 &&
            d.columnsToAdd.length === 0 &&
            d.columnsToDrop.length === 0
        );
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    private async tableExists(tableName: string): Promise<boolean> {
        const rows = await this.db.query<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            [tableName]
        );
        return rows.length > 0;
    }

    /** Returns a Map of columnName → ColumnInfo for columns present in the DB. */
    private async getExistingColumns(tableName: string): Promise<Map<string, ColumnInfo>> {
        const cols = await this.db.query<ColumnInfo>(`PRAGMA table_info(${tableName})`);
        const map = new Map<string, ColumnInfo>();
        for (const c of cols) {
            map.set(c.name, c);
        }
        return map;
    }
}
