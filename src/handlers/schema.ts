import { DatabaseContext } from '../context/db';


const createSchema = async (context: DatabaseContext, schema: string) => {
  const { db } = context;

  await db.raw('CREATE SCHEMA IF NOT EXISTS ??', [schema]);
};

/**
 * Drops the schema if it exists, then creates it empty.
 * Used for reorg rebuild so leftover tmp_public cannot be reused partially.
 */
const createSchemaFresh = async (context: DatabaseContext, schema: string): Promise<void> => {
  const { db } = context;
  await db.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [schema]);
  await db.raw('CREATE SCHEMA ??', [schema]);
};

/** Stable int64 key shared by all replicas; do not change after deploy without overlap window. */
const REORG_CLEANUP_LOCK_KEY = 4711042307;

type WithReorgLockResult<T> = { acquired: false } | { acquired: true; result: T };

/**
 * Runs `fn` under a Postgres transaction that holds pg_try_advisory_xact_lock
 * (exclusive). Other callers — including holders of the shared variant — see
 * `acquired: false` immediately (non-blocking).
 * Lock is released automatically on commit, rollback, or connection loss.
 *
 * Use this around the reorg rebuild so it cannot proceed while any normal
 * tick on any replica is mid-write (those ticks hold the shared variant).
 */
const withReorgLock = async <T>(
  context: DatabaseContext,
  fn: () => Promise<T>
): Promise<WithReorgLockResult<T>> => {
  const { db } = context;
  return db.transaction(async (trx) => {
    const lockResult = await trx.raw<{ rows: { acquired: boolean }[] }>(
      'SELECT pg_try_advisory_xact_lock(?) AS acquired',
      [REORG_CLEANUP_LOCK_KEY]
    );
    const acquired = lockResult.rows[0]?.acquired === true;

    if (!acquired) {
      return { acquired: false as const };
    }

    const result = await fn();
    return { acquired: true as const, result };
  });
};

/**
 * Runs `fn` under a Postgres transaction that holds
 * pg_try_advisory_xact_lock_shared. Multiple shared holders coexist, so
 * normal ticks on different replicas don't block each other. Acquisition
 * fails only when another session holds the exclusive variant (a reorg
 * rebuild is in progress).
 *
 * Wrap normal strategy execution in this so a rebuild's switchSchema cannot
 * happen until all in-flight writers finish. That ensures the rebuild's
 * subgraph snapshot is taken at or after the latest committed writes.
 */
const withSharedReorgLock = async <T>(
  context: DatabaseContext,
  fn: () => Promise<T>
): Promise<WithReorgLockResult<T>> => {
  const { db } = context;
  return db.transaction(async (trx) => {
    const lockResult = await trx.raw<{ rows: { acquired: boolean }[] }>(
      'SELECT pg_try_advisory_xact_lock_shared(?) AS acquired',
      [REORG_CLEANUP_LOCK_KEY]
    );
    const acquired = lockResult.rows[0]?.acquired === true;

    if (!acquired) {
      return { acquired: false as const };
    }

    const result = await fn();
    return { acquired: true as const, result };
  });
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

export {
  createSchema,
  createSchemaFresh,
  switchSchema,
  withReorgLock,
  withSharedReorgLock,
};
