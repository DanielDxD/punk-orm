import { metadataStorage } from "../metadata/MetadataStorage.ts";

export interface ManyToOneOptions {
    foreignKey?: string;
    inverseSide?: string;
}

/**
 * Defines a Many-to-One relation. The entity that owns this property holds
 * the foreign key referencing the related entity.
 *
 * @example
 * @ManyToOne(() => User, { foreignKey: "authorId" })
 * author!: User;
 */
export function ManyToOne(
    target: () => new (...args: Array<unknown>) => unknown,
    options?: ManyToOneOptions
): PropertyDecorator {
    return function (host, propertyKey) {
        const key = String(propertyKey);
        const foreignKey = options?.foreignKey ?? key + "Id";

        metadataStorage.registerRelation(
            host.constructor as new (...args: Array<unknown>) => unknown,
            {
                propertyKey: key,
                relationType: "many-to-one",
                target,
                foreignKey,
                inverseSide: options?.inverseSide
            }
        );
    };
}
