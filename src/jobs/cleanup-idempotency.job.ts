import { Inject, Injectable } from '@nestjs/common';
import { lt } from 'drizzle-orm';
import { DATABASE, Database } from '../db/database';
import { idempotencyKeys } from '../db/schema';

/** Borra claves de idempotencia vencidas para que la tabla no crezca sin límite. */
@Injectable()
export class CleanupIdempotencyJob {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async runOnce(now = new Date()): Promise<number> {
    const deleted = await this.db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, now))
      .returning({ key: idempotencyKeys.key });
    return deleted.length;
  }
}
