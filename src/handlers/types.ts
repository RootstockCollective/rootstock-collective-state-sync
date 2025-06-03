type ColumnType = 'Boolean' | 'BigInt' | 'Bytes' | 'String';
type ArrayColumnType = [ColumnType];

const columnTypeMap: Record<ColumnType, string> = {
    Boolean: 'BOOLEAN',
    BigInt: 'TEXT',
    Bytes: 'BYTEA',
    String: 'TEXT'
} as const;

const isColumnType = (type: string): type is ColumnType =>
    Object.keys(columnTypeMap).includes(type);

const isArrayColumnType = (type: string | string[]): type is ArrayColumnType => {
    return Array.isArray(type) &&
        type.length === 1 &&
        typeof type[0] === "string" &&
        ["String", "Boolean", "BigInt", "Bytes"].includes(type[0]);
}

export type { ColumnType, ArrayColumnType }
export { columnTypeMap, isColumnType, isArrayColumnType }