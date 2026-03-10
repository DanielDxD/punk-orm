import "reflect-metadata";
import { metadataStorage } from "../metadata/MetadataStorage.ts";

export type GenerationStrategy = "increment" | "uuid";

/**
 * Marks a property as an auto-generated primary key.
 *
 * @param strategy - "increment" (default) uses SQLite AUTOINCREMENT integer.
 *                   "uuid" auto-generates a UUID v4 before insert.
 *
 * @example
 * @PrimaryGeneratedColumn("uuid")
 * id!: string;
 *
 * @example
 * @PrimaryGeneratedColumn()
 * id!: number;
 */
export function PrimaryGeneratedColumn(
    strategy: GenerationStrategy = "increment"
): PropertyDecorator {
    return function (target, propertyKey) {
        const key = String(propertyKey);

        metadataStorage.registerColumn(
            target.constructor as new (...args: Array<unknown>) => unknown,
            {
                propertyKey: key,
                columnName: key,
                type: strategy === "uuid" ? "uuid" : "integer",
                nullable: false,
                unique: true,
                isPrimary: true,
                isGenerated: true,
                generationStrategy: strategy
            }
        );
    };
}
