import './setup-env';
import { runMigrations } from '../src/db/migrate';

export default async function globalSetup(): Promise<void> {
  await runMigrations(process.env.DATABASE_URL!);
}
