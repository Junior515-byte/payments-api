import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** Transacción o conexión: los repositorios aceptan ambos. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | Tx;

export const DATABASE = Symbol('DATABASE');
export const PG_POOL = Symbol('PG_POOL');

export function createPool(url: string): Pool {
  return new Pool({ connectionString: url, max: 10 });
}

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema });
}

/** Postgres unique_violation (23505). Drizzle puede envolver el error original en `cause`. */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let i = 0; i < 3 && current; i++) {
    if ((current as { code?: string }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
