import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../config/app-config';
import { GatewayClient, GatewayUnavailableError } from './gateway.client';

/**
 * Pasarela simulada (inspirada en el flujo de Bancard vPOS: single_buy -> process_id -> redirect).
 * Permite inyectar fallas con GATEWAY_FAILURE_RATE para probar los reintentos.
 */
@Injectable()
export class FakeGatewayClient implements GatewayClient {
  private readonly checkouts = new Map<string, { providerRef: string; checkoutUrl: string }>();
  failureRate: number;

  constructor(private readonly config: AppConfig) {
    this.failureRate = config.gatewayFailureRate;
  }

  async createCheckout(input: { shopProcessId: string }) {
    this.maybeFail();
    const existing = this.checkouts.get(input.shopProcessId);
    if (existing) return existing;
    const providerRef = `gw_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const checkout = {
      providerRef,
      checkoutUrl: `${this.config.gatewayCheckoutBaseUrl}/${providerRef}`,
    };
    this.checkouts.set(input.shopProcessId, checkout);
    return checkout;
  }

  async requestRefund(): Promise<void> {
    this.maybeFail();
  }

  private maybeFail(): void {
    if (Math.random() < this.failureRate) throw new GatewayUnavailableError();
  }
}
