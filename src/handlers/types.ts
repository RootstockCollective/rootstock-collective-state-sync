import { Entity } from "../config/types";

export type ColumnType = 'Boolean' | 'BigInt' | 'Bytes' | 'String';
export type ArrayColumnType = [ColumnType];

export interface DatabaseSchema {
    entities: Map<string, Entity>;
}

export const columnTypeMap: Record<ColumnType, string> = {
    Boolean: 'BOOLEAN',
    BigInt: 'TEXT',
    Bytes: 'BYTEA',
    String: 'TEXT'
} as const;

export const isColumnType = (type: string): type is ColumnType =>
    Object.keys(columnTypeMap).includes(type);

export const isArrayColumnType = (type: string | string[]): type is ArrayColumnType => {
    return Array.isArray(type) &&
        type.length === 1 &&
        typeof type[0] === "string" &&
        ["String", "Boolean", "BigInt", "Bytes"].includes(type[0]);
}