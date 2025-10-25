import { DatabaseContext } from '../context/db';


const createSchema = async (context: DatabaseContext, schema: string) => {
  const { db } = context;

  await db.raw('CREATE SCHEMA IF NOT EXISTS ??', [schema]);
};

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

    // 2. Find all users that had SELECT in the old schema
    const users = await trx('information_schema.role_table_grants')
      .distinct()
      .where({ table_schema: oldSchema, privilege_type: 'SELECT' })
      .pluck('grantee');

    // 3. Reapply minimal read-only grants
    for (const user of users) {
      await trx.raw('GRANT USAGE ON SCHEMA ?? TO ??', [currentSchema, user]);
      await trx.raw('GRANT SELECT ON ALL TABLES IN SCHEMA ?? TO ??', [currentSchema, user]);
      await trx.raw('GRANT SELECT ON ALL SEQUENCES IN SCHEMA ?? TO ??', [currentSchema, user]);
      await trx.raw(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA ?? GRANT SELECT ON TABLES TO ??',
        [currentSchema, user]
      );
      await trx.raw(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA ?? GRANT SELECT ON SEQUENCES TO ??',
        [currentSchema, user]
      );
    }

    // 3. Drop the old schema
    await trx.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [oldSchema]);
  });
};

export { createSchema, switchSchema };
