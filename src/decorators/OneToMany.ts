import { metadataStorage } from "../metadata/MetadataStorage.ts";

export interface OneToManyOptions {
    foreignKey: string;
    inverseSide?: string;
}

/**
 * Defines a One-to-Many relation. The entity that owns this property holds
 * a collection of the related entity. The foreign key lives on the related side.
 *
 * @example
 * @OneToMany(() => Post, { foreignKey: "authorId" })
 * posts!: Array<Post>;
 */
export function OneToMany(
    target: () => new (...args: Array<unknown>) => unknown,
    options: OneToManyOptions
): PropertyDecorator {
    return function (host, propertyKey) {
        const key = String(propertyKey);
        metadataStorage.registerRelation(
            host.constructor as new (...args: Array<unknown>) => unknown,
            {
                propertyKey: key,
                relationType: "one-to-many",
                target,
                foreignKey: options.foreignKey,
                inverseSide: options.inverseSide
            }
        );
    };
}
