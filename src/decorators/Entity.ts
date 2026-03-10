import "reflect-metadata";
import { metadataStorage } from "../metadata/MetadataStorage.ts";

export interface EntityOptions {
    tableName?: string;
}

/**
 * Marks a class as a database entity.
 *
 * @example
 * @Entity("users")
 * class User { ... }
 */
export function Entity(tableNameOrOptions?: string | EntityOptions): ClassDecorator {
    return function (target) {
        let tableName: string;

        if (typeof tableNameOrOptions === "string") {
            tableName = tableNameOrOptions;
        } else if (tableNameOrOptions?.tableName) {
            tableName = tableNameOrOptions.tableName;
        } else {
            tableName = target.name.toLowerCase() + "s";
        }

        metadataStorage.registerEntity(
            target as unknown as new (...args: Array<unknown>) => unknown,
            tableName
        );
    };
}
