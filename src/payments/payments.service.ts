import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { AppConfig } from '../config/app-config';
import { ApiError } from '../common/errors';
import { DATABASE, Database, isUniqueViolation } from '../db/database';
import { Payment, paymentTransitions, payments } from '../db/schema';
import { GATEWAY_CLIENT, GatewayClient } from '../gateway/gateway.client';
import { OutboxRepository } from '../outbox/outbox.repository';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentTransitionsService } from './payment-transitions.service';
import { toPaymentEventPayload, toPaymentView, PaymentView } from './payment.mapper';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(GATEWAY_CLIENT) private readonly gateway: GatewayClient,
    private readonly transitions: PaymentTransitionsService,
    private readonly outbox: OutboxRepository,
    private readonly config: AppConfig,
  ) {}

  async create(dto: CreatePaymentDto): Promise<PaymentView> {
    let payment = await this.insertOrGetExisting(dto);

    // Si un intento anterior creó el pago pero falló la pasarela, se reintenta el checkout.
    // Es seguro: la pasarela deduplica por shopProcessId (= id del pago).
    if (!payment.checkoutUrl && payment.status === 'PENDING') {
      const checkout = await this.callGateway(() =>
        this.gateway.createCheckout({
          shopProcessId: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          description: payment.description,
        }),
      );
      [payment] = await this.db
        .update(payments)
        .set({ providerRef: checkout.providerRef, checkoutUrl: checkout.checkoutUrl })
        .where(eq(payments.id, payment.id))
        .returning();
    }
    return toPaymentView(payment);
  }

  async findById(id: string): Promise<PaymentView> {
    const payment = await this.db.query.payments.findFirst({ where: eq(payments.id, id) });
    if (!payment)
      throw new ApiError(HttpStatus.NOT_FOUND, 'PAYMENT_NOT_FOUND', 'Pago no encontrado');
    const history = await this.db
      .select()
      .from(paymentTransitions)
      .where(eq(paymentTransitions.paymentId, id))
      .orderBy(asc(paymentTransitions.createdAt));
    return toPaymentView(payment, history);
  }

  /**
   * Reembolso en dos fases: primero se marca REFUND_PENDING (commit), luego se llama a la
   * pasarela, y el webhook refund.succeeded confirma. Nunca se marca REFUNDED sin confirmación.
   */
  async refund(id: string, dto: RefundPaymentDto): Promise<PaymentView> {
    const payment = await this.db.transaction(async (tx) => {
      const current = await this.transitions.lock(tx, id);
      if (!current)
        throw new ApiError(HttpStatus.NOT_FOUND, 'PAYMENT_NOT_FOUND', 'Pago no encontrado');
      const result = await this.transitions.apply(tx, current, 'REFUND_PENDING', {
        source: 'api',
        reason: dto.reason ?? 'requested_by_merchant',
      });
      if (!result.applied) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'INVALID_STATE_TRANSITION',
          `No se puede reembolsar un pago en estado ${current.status}`,
        );
      }
      return result.payment;
    });

    try {
      await this.callGateway(() =>
        this.gateway.requestRefund({
          shopProcessId: payment.id,
          providerRef: payment.providerRef!,
          amount: payment.amount,
        }),
      );
    } catch (err) {
      // Compensación: la pasarela no aceptó el reembolso, el pago vuelve a APPROVED.
      await this.db.transaction(async (tx) => {
        const current = await this.transitions.lock(tx, id);
        if (current) {
          await this.transitions.apply(tx, current, 'APPROVED', {
            source: 'api',
            reason: 'refund_request_failed',
            eventType: 'payment.refund_failed',
          });
        }
      });
      throw err;
    }
    return toPaymentView(payment);
  }

  private async insertOrGetExisting(dto: CreatePaymentDto): Promise<Payment> {
    try {
      return await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(payments)
          .values({
            merchantOrderId: dto.merchantOrderId,
            amount: dto.amount,
            currency: dto.currency,
            description: dto.description,
            expiresAt: new Date(Date.now() + this.config.paymentTtlMinutes * 60_000),
          })
          .returning();
        await tx.insert(paymentTransitions).values({
          paymentId: created.id,
          from: null,
          to: 'PENDING',
          source: 'api',
          reason: 'created',
        });
        await this.outbox.enqueue(tx, {
          aggregateId: created.id,
          type: 'payment.created',
          payload: toPaymentEventPayload(created),
        });
        return created;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }

    // Segunda línea de defensa: aunque el cliente use OTRA Idempotency-Key,
    // la misma orden del comercio nunca genera dos pagos.
    const existing = await this.db.query.payments.findFirst({
      where: eq(payments.merchantOrderId, dto.merchantOrderId),
    });
    if (!existing) throw new Error('Unique violation sin fila existente');
    if (existing.amount !== dto.amount || existing.currency !== dto.currency) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'MERCHANT_ORDER_CONFLICT',
        'Ya existe un pago para esta orden con otro monto o moneda',
      );
    }
    return existing;
  }

  private async callGateway<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'Falla en la pasarela');
      throw new ApiError(
        HttpStatus.BAD_GATEWAY,
        'GATEWAY_UNAVAILABLE',
        'La pasarela de pagos no está disponible; reintentá con la misma Idempotency-Key',
      );
    }
  }
}
