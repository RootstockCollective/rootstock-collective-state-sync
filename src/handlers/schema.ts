import { DatabaseContext } from "../context/db";


const createSchema = async (context: DatabaseContext, schema: string) => {
    const { db } = context;

    await db.raw('CREATE SCHEMA IF NOT EXISTS ??', [schema]);
}

const switchSchema = async (
    context: DatabaseContext,
    newSchema: string,
    currentSchema: string
) => {
    const { db } = context;
    const oldSchema = `old_${currentSchema}`;

    await db.transaction(async trx => {
        // 1. Rename current schema to old schema
        await trx.raw('ALTER SCHEMA ?? RENAME TO ??', [currentSchema, oldSchema]);

        // 2. Rename new schema to current schema
        await trx.raw('ALTER SCHEMA ?? RENAME TO ??', [newSchema, currentSchema]);

        // 3. Drop the old schema
        await trx.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [oldSchema]);
    });
}

export { createSchema, switchSchema }