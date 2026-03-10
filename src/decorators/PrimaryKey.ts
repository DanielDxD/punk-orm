import "reflect-metadata";
import { metadataStorage } from "../metadata/MetadataStorage.ts";

/**
 * Marks a property as the primary key column (manual value, no auto-generation).
 *
 * @example
 * @PrimaryKey()
 * id!: string;
 */
export function PrimaryKey(): PropertyDecorator {
    return function (target, propertyKey) {
        const key = String(propertyKey);

        metadataStorage.registerColumn(
            target.constructor as new (...args: Array<unknown>) => unknown,
            {
                propertyKey: key,
                columnName: key,
                type: "text",
                nullable: false,
                unique: true,
                isPrimary: true,
                isGenerated: false
            }
        );
    };
}
