import type { PaymentStatus } from '../db/schema';

/**
 * Transiciones válidas. Cualquier otra se rechaza (API) o se ignora y audita (webhooks).
 *
 *   PENDING ──approved──▶ APPROVED ──refund──▶ REFUND_PENDING ──ok──▶ REFUNDED
 *      │                     ▲                       │
 *      ├──rejected──▶ REJECTED                       └──failed──▶ APPROVED
 *      └──ttl──▶ EXPIRED ──approved (tardío)──┘
 *
 * EXPIRED -> APPROVED existe a propósito: la pasarela es la fuente de verdad del dinero.
 * Si el cliente pagó justo cuando expiraba, no podemos "perder" ese cobro.
 */
const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'EXPIRED'],
  EXPIRED: ['APPROVED'],
  APPROVED: ['REFUND_PENDING'],
  REFUND_PENDING: ['REFUNDED', 'APPROVED'],
  REJECTED: [],
  REFUNDED: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isFinal(status: PaymentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
