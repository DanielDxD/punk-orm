export type ColumnType = "text" | "integer" | "real" | "blob" | "boolean" | "datetime" | "uuid";

export interface ColumnMetadata {
    propertyKey: string;
    columnName: string;
    type: ColumnType;
    nullable: boolean;
    unique: boolean;
    default?: unknown;
    isPrimary: boolean;
    isGenerated: boolean;
    generationStrategy?: "increment" | "uuid";
}

export interface RelationMetadata {
    propertyKey: string;
    relationType: "one-to-many" | "many-to-one";
    target: () => new (...args: Array<unknown>) => unknown;
    foreignKey: string;
    inverseSide?: string;
}

export interface EntityMetadata {
    target: new (...args: Array<unknown>) => unknown;
    tableName: string;
    columns: Array<ColumnMetadata>;
    relations: Array<RelationMetadata>;
}
