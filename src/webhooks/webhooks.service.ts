import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DATABASE, Database, Tx } from '../db/database';
import { PaymentStatus, webhookEvents } from '../db/schema';
import { PaymentTransitionsService } from '../payments/payment-transitions.service';
import { GatewayEventType, GatewayWebhookDto } from './dto/gateway-webhook.dto';

/** Qué estado produce cada evento y desde qué estados es legítimo aplicarlo. */
const RULES: Record<
  GatewayEventType,
  { to: PaymentStatus; from: PaymentStatus[]; eventType?: string }
> = {
  'payment.approved': { to: 'APPROVED', from: ['PENDING', 'EXPIRED'] },
  'payment.rejected': { to: 'REJECTED', from: ['PENDING'] },
  'refund.succeeded': { to: 'REFUNDED', from: ['REFUND_PENDING'] },
  'refund.failed': { to: 'APPROVED', from: ['REFUND_PENDING'], eventType: 'payment.refund_failed' },
};

export interface WebhookOutcome {
  received: true;
  duplicate?: true;
  result?: 'APPLIED' | 'IGNORED';
  reason?: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly transitions: PaymentTransitionsService,
  ) {}

  /**
   * Todo en UNA transacción: registrar el evento (dedupe), bloquear el pago, transicionar y
   * encolar la notificación. Si algo falla, rollback completo y la pasarela reintenta.
   */
  async process(event: GatewayWebhookDto): Promise<WebhookOutcome> {
    return this.db.transaction(async (tx) => {
      // Dedupe: la PK es el id del evento. Si llegan duplicados en paralelo, el segundo
      // espera el commit del primero y luego no inserta nada.
      const inserted = await tx
        .insert(webhookEvents)
        .values({ id: event.id, type: event.type, payload: event, result: 'IGNORED' })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id });
      if (inserted.length === 0) return { received: true, duplicate: true };

      const outcome = await this.applyEvent(tx, event);
      await tx
        .update(webhookEvents)
        .set({ result: outcome.result, reason: outcome.reason })
        .where(eq(webhookEvents.id, event.id));
      return { received: true, ...outcome };
    });
  }

  private async applyEvent(
    tx: Tx,
    event: GatewayWebhookDto,
  ): Promise<{ result: 'APPLIED' | 'IGNORED'; reason?: string }> {
    const payment = await this.transitions.lock(tx, event.data.shopProcessId);
    if (!payment) {
      this.logger.warn({ eventId: event.id }, 'Webhook de un pago desconocido');
      return { result: 'IGNORED', reason: 'unknown_payment' };
    }

    if (payment.amount !== event.data.amount || payment.currency !== event.data.currency) {
      // Nunca confiar ciegamente en la pasarela: un monto distinto requiere revisión humana.
      this.logger.error(
        {
          eventId: event.id,
          paymentId: payment.id,
          expected: payment.amount,
          got: event.data.amount,
        },
        'Monto del webhook no coincide con el pago',
      );
      return { result: 'IGNORED', reason: 'amount_mismatch' };
    }

    const rule = RULES[event.type];
    if (payment.status === rule.to && !rule.eventType) {
      return { result: 'IGNORED', reason: 'already_in_state' };
    }
    if (!rule.from.includes(payment.status)) {
      // Evento fuera de orden o viejo (ej: "rejected" después de "approved").
      return { result: 'IGNORED', reason: `stale_event_for_${payment.status.toLowerCase()}` };
    }

    const lateApproval = payment.status === 'EXPIRED' && rule.to === 'APPROVED';
    if (lateApproval) {
      this.logger.warn({ paymentId: payment.id }, 'Aprobación recibida después de expirar');
    }

    await this.transitions.apply(tx, payment, rule.to, {
      source: 'webhook',
      reason: lateApproval ? 'approved_after_expiry' : (event.data.reason ?? event.type),
      eventType: rule.eventType,
      eventData: lateApproval ? { lateApproval: true } : undefined,
    });
    return { result: 'APPLIED' };
  }
}
