import type { Currency } from '../db/schema';

/**
 * Puerto hacia la pasarela de pagos (Bancard, Pagopar, Stripe...).
 * El dominio no conoce al proveedor concreto: se puede cambiar sin tocar la lógica de pagos.
 */
export interface GatewayClient {
  /**
   * Debe ser idempotente por shopProcessId: si se llama dos veces con el mismo id,
   * la pasarela devuelve el mismo checkout en vez de crear otro.
   */
  createCheckout(input: {
    shopProcessId: string;
    amount: number;
    currency: Currency;
    description?: string | null;
  }): Promise<{ providerRef: string; checkoutUrl: string }>;

  requestRefund(input: {
    shopProcessId: string;
    providerRef: string;
    amount: number;
  }): Promise<void>;
}

export const GATEWAY_CLIENT = Symbol('GATEWAY_CLIENT');

export class GatewayUnavailableError extends Error {
  constructor(message = 'La pasarela no respondió') {
    super(message);
  }
}
