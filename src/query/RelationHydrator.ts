import { metadataStorage } from "../metadata/MetadataStorage.ts";

export interface HydrateOptions {
    includes: Set<string>;
    rootEntityClass: new (...args: Array<unknown>) => unknown;
}

/**
 * Reconstructs nested entity trees from flat, aliased SQL result sets.
 *
 * Expected format of rows:
 * {
 *   t0_id: 1, t0_name: 'Alice',
 *   t1_id: 10, t1_title: 'Post 1',
 *   t2_id: 100, t2_content: 'Comment 1'
 * }
 */
export class RelationHydrator {
    public static hydrate<T extends object>(
        rows: Array<Record<string, unknown>>,
        options: HydrateOptions
    ): Array<T> {
        if (rows.length === 0) return [];

        const rootMeta = metadataStorage.getEntityByTarget(options.rootEntityClass);
        if (!rootMeta) return [];

        const pkProp = rootMeta.columns.find((c) => c.isPrimary)?.propertyKey ?? "id";
        const result = new Map<unknown, T>();

        // Map relation name to its metadata and index (t1, t2...)
        const inclusionMap = new Map<string, { meta: any; alias: string }>();
        const includes = Array.from(options.includes);
        for (const relKey of includes) {
            const relMeta = rootMeta.relations.find((r) => r.propertyKey === relKey);
            if (relMeta) {
                inclusionMap.set(relKey, {
                    meta: relMeta,
                    alias: `t${inclusionMap.size + 1}`
                });
            }
        }

        for (const row of rows) {
            const rootId = row[`t0_${pkProp}`];
            if (rootId === null || rootId === undefined) continue;

            let root = result.get(rootId);
            if (!root) {
                root = new options.rootEntityClass() as T;
                this.fillProps(root, row, "t0", rootMeta.columns);
                result.set(rootId, root);
            }

            // Hydrate children
            for (const [relKey, info] of inclusionMap) {
                const childTarget = info.meta.target();
                const childMeta = metadataStorage.getEntityByTarget(childTarget);
                if (!childMeta) continue;

                const childPkProp = childMeta.columns.find((c) => c.isPrimary)?.propertyKey ?? "id";
                const childId = row[`${info.alias}_${childPkProp}`];

                if (childId === null || childId === undefined) {
                    // Set empty array for OneToMany or null for ManyToOne if not already set
                    if (info.meta.relationType === "one-to-many") {
                        (root as any)[relKey] ||= [];
                    } else {
                        (root as any)[relKey] ||= null;
                    }
                    continue;
                }

                if (info.meta.relationType === "many-to-one") {
                    if (!(root as any)[relKey]) {
                        const child = new childTarget();
                        this.fillProps(child, row, info.alias, childMeta.columns);
                        (root as any)[relKey] = child;
                    }
                } else if (info.meta.relationType === "one-to-many") {
                    const collection = ((root as any)[relKey] ||= []) as Array<any>;
                    const alreadyPresent = collection.find((item) => item[childPkProp] === childId);
                    if (!alreadyPresent) {
                        const child = new childTarget();
                        this.fillProps(child, row, info.alias, childMeta.columns);
                        collection.push(child);
                    }
                }
            }
        }

        return Array.from(result.values());
    }

    private static fillProps(
        target: any,
        row: Record<string, unknown>,
        alias: string,
        columns: Array<any>
    ) {
        for (const col of columns) {
            const val = row[`${alias}_${col.propertyKey}`];
            if (val !== undefined) {
                target[col.propertyKey] = val;
            }
        }
    }
}
