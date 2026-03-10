import type { ColumnMetadata, EntityMetadata, RelationMetadata } from "./EntityMetadata.ts";

class MetadataStorage {
    private entities = new Map<new (...args: Array<unknown>) => unknown, EntityMetadata>();

    // ── Entity ─────────────────────────────────────────────────────────────────

    public registerEntity(
        target: new (...args: Array<unknown>) => unknown,
        tableName: string
    ): void {
        if (!this.entities.has(target)) {
            this.entities.set(target, {
                target,
                tableName,
                columns: [],
                relations: []
            });
        } else {
            const existing = this.entities.get(target)!;
            existing.tableName = tableName;
        }
    }

    public getEntity(target: new (...args: Array<unknown>) => unknown): EntityMetadata | undefined {
        return this.entities.get(target);
    }

    public getAllEntities(): Array<EntityMetadata> {
        return Array.from(this.entities.values());
    }

    // ── Columns ────────────────────────────────────────────────────────────────

    public registerColumn(
        target: new (...args: Array<unknown>) => unknown,
        column: ColumnMetadata
    ): void {
        this.ensureEntity(target);
        const meta = this.entities.get(target)!;
        const existing = meta.columns.findIndex((c) => c.propertyKey === column.propertyKey);
        if (existing >= 0) {
            meta.columns[existing] = column;
        } else {
            meta.columns.push(column);
        }
    }

    public getColumns(target: new (...args: Array<unknown>) => unknown): Array<ColumnMetadata> {
        return this.entities.get(target)?.columns ?? [];
    }

    // ── Relations ──────────────────────────────────────────────────────────────

    public registerRelation(
        target: new (...args: Array<unknown>) => unknown,
        relation: RelationMetadata
    ): void {
        this.ensureEntity(target);
        const meta = this.entities.get(target)!;
        const existing = meta.relations.findIndex((r) => r.propertyKey === relation.propertyKey);
        if (existing >= 0) {
            meta.relations[existing] = relation;
        } else {
            meta.relations.push(relation);
        }
    }

    public getRelations(target: new (...args: Array<unknown>) => unknown): Array<RelationMetadata> {
        return this.entities.get(target)?.relations ?? [];
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private ensureEntity(target: new (...args: Array<unknown>) => unknown): void {
        if (!this.entities.has(target)) {
            const tableName = target.name.toLowerCase() + "s";
            this.entities.set(target, { target, tableName, columns: [], relations: [] });
        }
    }
}

// Global singleton using globalThis to avoid multiple instances in bundled environments
const GLOBAL_KEY = "__PUNK_ORM_METADATA_STORAGE__";

if (!(globalThis as any)[GLOBAL_KEY]) {
    (globalThis as any)[GLOBAL_KEY] = new MetadataStorage();
}

export const metadataStorage: MetadataStorage = (globalThis as any)[GLOBAL_KEY];
