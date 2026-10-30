import { CanActivate, ExecutionContext, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfig } from '../config/app-config';
import { ApiError } from '../common/errors';
import { verifySignature } from '../common/signature';

export const GATEWAY_SIGNATURE_HEADER = 'x-gateway-signature';

/**
 * Corre ANTES de la validación del body: un request sin firma válida no recibe
 * ninguna información sobre el formato esperado.
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);

  constructor(private readonly config: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const check = verifySignature({
      secret: this.config.gatewayWebhookSecret,
      rawBody: req.rawBody ?? Buffer.alloc(0),
      header: req.header(GATEWAY_SIGNATURE_HEADER),
      toleranceSeconds: this.config.webhookToleranceSeconds,
    });
    if (!check.valid) {
      this.logger.warn({ reason: check.reason, ip: req.ip }, 'Webhook con firma inválida');
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_SIGNATURE', 'Firma de webhook inválida');
    }
    return true;
  }
}
