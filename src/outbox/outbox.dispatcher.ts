import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { AppConfig } from '../config/app-config';
import { backoffDelayMs } from '../common/backoff';
import { signPayload } from '../common/signature';
import { DATABASE, Database } from '../db/database';
import { OutboxEvent, outboxEvents } from '../db/schema';

export const MERCHANT_SIGNATURE_HEADER = 'x-signature';

/**
 * Publica los eventos del outbox al webhook del comercio.
 *
 * - Reclama lotes con FOR UPDATE SKIP LOCKED + locked_until: se pueden correr N workers
 *   en paralelo sin procesar dos veces el mismo evento ni bloquearse entre sí.
 * - El HTTP se hace FUERA de la transacción (no se retienen locks durante la red).
 * - Entrega at-least-once: el comercio deduplica por el header x-event-id.
 * - Tras OUTBOX_MAX_ATTEMPTS fallos el evento pasa a DEAD para revisión manual.
 */
@Injectable()
export class OutboxDispatcher {
  private readonly logger = new Logger(OutboxDispatcher.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: AppConfig,
  ) {}

  async runOnce(): Promise<{ sent: number; failed: number }> {
    const batch = await this.claimBatch();
    let sent = 0;
    let failed = 0;
    await Promise.all(
      batch.map(async (event) => {
        const error = await this.deliver(event);
        if (error) {
          failed++;
          await this.markFailed(event, error);
        } else {
          sent++;
          await this.db
            .update(outboxEvents)
            .set({ status: 'SENT', sentAt: new Date(), lockedUntil: null, lastError: null })
            .where(eq(outboxEvents.id, event.id));
        }
      }),
    );
    return { sent, failed };
  }

  private async claimBatch(): Promise<OutboxEvent[]> {
    const result = await this.db.execute<Record<string, unknown>>(sql`
      UPDATE outbox_events
         SET locked_until = now() + interval '30 seconds',
             attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM outbox_events
          WHERE status = 'PENDING'
            AND next_attempt_at <= now()
            AND (locked_until IS NULL OR locked_until < now())
          ORDER BY created_at
          LIMIT ${this.config.outboxBatchSize}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id, aggregate_id, type, payload, attempts, created_at`);
    return result.rows.map((r) => ({
      id: r.id as string,
      aggregateId: r.aggregate_id as string,
      type: r.type as string,
      payload: r.payload,
      attempts: r.attempts as number,
      createdAt: new Date(r.created_at as string),
    })) as OutboxEvent[];
  }

  /** Devuelve null si se entregó, o el mensaje de error. */
  private async deliver(event: OutboxEvent): Promise<string | null> {
    const body = JSON.stringify({
      id: event.id,
      type: event.type,
      createdAt: event.createdAt.toISOString(),
      data: event.payload,
    });
    try {
      const res = await fetch(this.config.merchantWebhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-event-id': event.id,
          [MERCHANT_SIGNATURE_HEADER]: signPayload(
            this.config.merchantWebhookSecret,
            body,
            Math.floor(Date.now() / 1000),
          ),
        },
        body,
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok ? null : `HTTP ${res.status}`;
    } catch (err) {
      return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
  }

  private async markFailed(event: OutboxEvent, error: string): Promise<void> {
    const dead = event.attempts >= this.config.outboxMaxAttempts;
    const delay = backoffDelayMs(event.attempts);
    await this.db
      .update(outboxEvents)
      .set({
        status: dead ? 'DEAD' : 'PENDING',
        lastError: error.slice(0, 500),
        lockedUntil: null,
        nextAttemptAt: new Date(Date.now() + delay),
      })
      .where(eq(outboxEvents.id, event.id));
    const log = { eventId: event.id, type: event.type, attempts: event.attempts, error };
    if (dead) this.logger.error(log, 'Evento enviado a DEAD tras agotar reintentos');
    else this.logger.warn({ ...log, retryInMs: delay }, 'Falló la entrega; se reintentará');
  }
}
