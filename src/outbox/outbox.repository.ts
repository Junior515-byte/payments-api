import { Injectable } from '@nestjs/common';
import type { DbOrTx } from '../db/database';
import { outboxEvents } from '../db/schema';

export interface DomainEvent {
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Se escribe en la MISMA transacción que el cambio de estado.
 * Así nunca hay un pago aprobado sin su evento, ni un evento de un cambio que hizo rollback.
 */
@Injectable()
export class OutboxRepository {
  async enqueue(tx: DbOrTx, event: DomainEvent): Promise<void> {
    await tx.insert(outboxEvents).values(event);
  }
}
