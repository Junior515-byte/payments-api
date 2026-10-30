import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as path from 'node:path';
import { createDatabase, createPool } from './database';

/** Aplica las migraciones SQL de /drizzle. Se ejecuta antes de levantar API/worker. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl);
  try {
    await migrate(createDatabase(pool), {
      migrationsFolder: path.resolve(__dirname, '../../drizzle'),
    });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL es obligatoria');
  runMigrations(url)
    .then(() => process.stdout.write('Migraciones aplicadas\n'))
    .catch((err) => {
      process.stderr.write(`Error en migraciones: ${String(err)}\n`);
      process.exit(1);
    });
}
