import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig } from '../config/app-config';
import { createDatabase, createPool, DATABASE, PG_POOL } from './database';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [AppConfig],
      useFactory: (c: AppConfig) => createPool(c.databaseUrl),
    },
    { provide: DATABASE, inject: [PG_POOL], useFactory: (pool: Pool) => createDatabase(pool) },
  ],
  exports: [DATABASE, PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
