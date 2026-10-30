import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { DATABASE, Database } from '../db/database';
import { payments } from '../db/schema';
import { PaymentTransitionsService } from '../payments/payment-transitions.service';

/** Expira pagos PENDING cuyo checkout venció (el cliente abandonó). */
@Injectable()
export class ExpirePaymentsJob {
  private readonly logger = new Logger(ExpirePaymentsJob.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly transitions: PaymentTransitionsService,
  ) {}

  async runOnce(now = new Date()): Promise<number> {
    const candidates = await this.db
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.status, 'PENDING'), lt(payments.expiresAt, now)))
      .limit(100);

    let expired = 0;
    for (const { id } of candidates) {
      // Se re-lee con lock: si justo llegó el webhook de aprobación, apply() lo detecta.
      const applied = await this.db.transaction(async (tx) => {
        const current = await this.transitions.lock(tx, id);
        if (!current || current.status !== 'PENDING') return false;
        const r = await this.transitions.apply(tx, current, 'EXPIRED', {
          source: 'expiration-job',
          reason: 'checkout_ttl_exceeded',
        });
        return r.applied;
      });
      if (applied) expired++;
    }
    if (expired > 0) this.logger.log({ expired }, 'Pagos expirados');
    return expired;
  }
}
