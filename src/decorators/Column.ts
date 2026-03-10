import "reflect-metadata";
import type { ColumnType } from "../metadata/EntityMetadata.ts";
import { metadataStorage } from "../metadata/MetadataStorage.ts";

export interface ColumnOptions {
    name?: string;
    type?: ColumnType;
    nullable?: boolean;
    unique?: boolean;
    default?: unknown;
}

/**
 * Marks a property as a database column.
 *
 * @example
 * @Column({ type: "text", nullable: false })
 * name!: string;
 */
export function Column(options?: ColumnOptions): PropertyDecorator {
    return function (target, propertyKey) {
        const key = String(propertyKey);
        const reflectedType = Reflect.getMetadata("design:type", target, propertyKey);
        const type = options?.type ?? inferColumnType(reflectedType);

        metadataStorage.registerColumn(
            target.constructor as new (...args: Array<unknown>) => unknown,
            {
                propertyKey: key,
                columnName: options?.name ?? key,
                type,
                nullable: options?.nullable ?? false,
                unique: options?.unique ?? false,
                default: options?.default,
                isPrimary: false,
                isGenerated: false
            }
        );
    };
}

function inferColumnType(reflectedType: unknown): ColumnType {
    if (reflectedType === Number) return "integer";
    if (reflectedType === Boolean) return "boolean";
    if (reflectedType === Date) return "datetime";
    return "text";
}
