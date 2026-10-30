import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const paymentStatus = pgEnum('payment_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'REFUND_PENDING',
  'REFUNDED',
]);
export const currency = pgEnum('currency', ['PYG', 'USD']);
export const idempotencyStatus = pgEnum('idempotency_status', ['IN_PROGRESS', 'COMPLETED']);
export const outboxStatus = pgEnum('outbox_status', ['PENDING', 'SENT', 'DEAD']);
export const webhookResult = pgEnum('webhook_result', ['APPLIED', 'IGNORED']);

export type PaymentStatus = (typeof paymentStatus.enumValues)[number];
export type Currency = (typeof currency.enumValues)[number];

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Montos en unidades mínimas: guaraníes no tienen decimales; USD en centavos. */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    merchantOrderId: text('merchant_order_id').notNull().unique(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: currency('currency').notNull(),
    description: text('description'),
    status: paymentStatus('status').notNull().default('PENDING'),
    providerRef: text('provider_ref').unique(),
    checkoutUrl: text('checkout_url'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('payments_status_expires_idx').on(t.status, t.expiresAt)],
);

/** Historial inmutable de cambios de estado (auditoría). */
export const paymentTransitions = pgTable(
  'payment_transitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    from: paymentStatus('from'),
    to: paymentStatus('to').notNull(),
    source: text('source').notNull(),
    reason: text('reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('payment_transitions_payment_idx').on(t.paymentId, t.createdAt)],
);

/** Clave de idempotencia por (scope, key). scope = "METHOD /path". */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: idempotencyStatus('status').notNull(),
    responseCode: integer('response_code'),
    /** Texto JSON exacto: el replay devuelve los mismos bytes (jsonb reordena claves). */
    responseBody: text('response_body'),
    lockedAt: ts('locked_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.key] }),
    index('idempotency_expires_idx').on(t.expiresAt),
  ],
);

/** Webhooks entrantes. El id del evento de la pasarela es la PK => deduplicación. */
export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  result: webhookResult('result').notNull(),
  reason: text('reason'),
  receivedAt: ts('received_at').notNull().defaultNow(),
});

/** Transactional outbox: eventos para notificar al comercio (entrega at-least-once). */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    aggregateId: uuid('aggregate_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    status: outboxStatus('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
    lockedUntil: ts('locked_until'),
    lastError: text('last_error'),
    createdAt: ts('created_at').notNull().defaultNow(),
    sentAt: ts('sent_at'),
  },
  (t) => [index('outbox_pending_idx').on(t.status, t.nextAttemptAt)],
);

export type Payment = typeof payments.$inferSelect;
export type PaymentTransition = typeof paymentTransitions.$inferSelect;
export type OutboxEvent = typeof outboxEvents.$inferSelect;
