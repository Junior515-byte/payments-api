import type { Payment, PaymentTransition } from '../db/schema';

export interface PaymentView {
  id: string;
  merchantOrderId: string;
  amount: number;
  currency: string;
  description: string | null;
  status: string;
  checkoutUrl: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  history?: Array<{
    from: string | null;
    to: string;
    source: string;
    reason: string | null;
    at: string;
  }>;
}

export function toPaymentView(p: Payment, transitions?: PaymentTransition[]): PaymentView {
  return {
    id: p.id,
    merchantOrderId: p.merchantOrderId,
    amount: p.amount,
    currency: p.currency,
    description: p.description,
    status: p.status,
    checkoutUrl: p.checkoutUrl,
    expiresAt: p.expiresAt.toISOString(),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    ...(transitions && {
      history: transitions.map((t) => ({
        from: t.from,
        to: t.to,
        source: t.source,
        reason: t.reason,
        at: t.createdAt.toISOString(),
      })),
    }),
  };
}

export function toPaymentEventPayload(p: Payment): Record<string, unknown> {
  return {
    paymentId: p.id,
    merchantOrderId: p.merchantOrderId,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
  };
}
