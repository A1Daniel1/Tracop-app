import { sql } from 'drizzle-orm';
import pg from 'pg';
import { DatabaseService } from '../src/shared/infra/database.js';
import type { AppEnvironment } from '../src/shared/infra/env.js';
import { describePostgres } from './postgres-suite.js';

describePostgres('Ordering PostgreSQL timeout mappings', () => {
  it('maps 55P03 to lock_timeout deterministically', async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('LOCK TABLE catalog.categories IN ACCESS EXCLUSIVE MODE');

      const database = new DatabaseService(pool, {
        ORDER_LOCK_TIMEOUT_MS: 50,
        ORDER_STATEMENT_TIMEOUT_MS: 500,
      } as AppEnvironment);
      await expect(
        database.transaction(() =>
          database.current().execute(sql`LOCK TABLE catalog.categories IN ACCESS EXCLUSIVE MODE`),
        ),
      ).rejects.toMatchObject({ code: 'lock_timeout' });
      await holder.query('ROLLBACK');
    } finally {
      holder.release();
      await pool.end();
    }
  });

  it('maps 57014 to statement_timeout deterministically', async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const database = new DatabaseService(pool, {
      ORDER_LOCK_TIMEOUT_MS: 500,
      ORDER_STATEMENT_TIMEOUT_MS: 50,
    } as AppEnvironment);
    try {
      await expect(
        database.transaction(() => database.current().execute(sql`SELECT pg_sleep(0.2)`)),
      ).rejects.toMatchObject({ code: 'statement_timeout' });
    } finally {
      await pool.end();
    }
  });
});
