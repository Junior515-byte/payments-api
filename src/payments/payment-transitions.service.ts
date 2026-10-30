import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Tx } from '../db/database';
import { Payment, PaymentStatus, paymentTransitions, payments } from '../db/schema';
import { OutboxRepository } from '../outbox/outbox.repository';
import { canTransition } from './payment-state-machine';
import { toPaymentEventPayload } from './payment.mapper';

export type TransitionSource = 'api' | 'webhook' | 'expiration-job';

export type TransitionResult =
  | { applied: true; payment: Payment; from: PaymentStatus }
  | { applied: false; payment: Payment; reason: 'already_in_state' | 'invalid_transition' };

@Injectable()
export class PaymentTransitionsService {
  constructor(private readonly outbox: OutboxRepository) {}

  /** SELECT ... FOR UPDATE: serializa cambios concurrentes sobre el MISMO pago. */
  async lock(tx: Tx, paymentId: string): Promise<Payment | undefined> {
    const [row] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
    return row;
  }

  /**
   * Aplica una transición dentro de una transacción ya abierta y con el pago bloqueado.
   * Registra auditoría y encola el evento de dominio en el outbox, todo atómico.
   */
  async apply(
    tx: Tx,
    current: Payment,
    to: PaymentStatus,
    meta: {
      source: TransitionSource;
      reason?: string;
      eventType?: string;
      eventData?: Record<string, unknown>;
    },
  ): Promise<TransitionResult> {
    if (current.status === to)
      return { applied: false, payment: current, reason: 'already_in_state' };
    if (!canTransition(current.status, to)) {
      return { applied: false, payment: current, reason: 'invalid_transition' };
    }

    const [updated] = await tx
      .update(payments)
      .set({ status: to, updatedAt: sql`now()` })
      .where(eq(payments.id, current.id))
      .returning();

    await tx.insert(paymentTransitions).values({
      paymentId: current.id,
      from: current.status,
      to,
      source: meta.source,
      reason: meta.reason,
    });

    await this.outbox.enqueue(tx, {
      aggregateId: current.id,
      type: meta.eventType ?? `payment.${to.toLowerCase()}`,
      payload: {
        ...toPaymentEventPayload(updated),
        previousStatus: current.status,
        ...meta.eventData,
      },
    });

    return { applied: true, payment: updated, from: current.status };
  }
}
