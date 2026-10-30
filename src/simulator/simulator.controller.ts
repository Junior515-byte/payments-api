import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../config/app-config';
import { ApiError } from '../common/errors';
import { signPayload, verifySignature } from '../common/signature';
import { DATABASE, Database } from '../db/database';
import { payments } from '../db/schema';
import { GATEWAY_EVENT_TYPES, GatewayEventType } from '../webhooks/dto/gateway-webhook.dto';
import { GATEWAY_SIGNATURE_HEADER } from '../webhooks/webhook-signature.guard';
import { MERCHANT_SIGNATURE_HEADER } from '../outbox/outbox.dispatcher';

class SimulateEventDto {
  @ApiProperty({ enum: GATEWAY_EVENT_TYPES })
  @IsIn(GATEWAY_EVENT_TYPES)
  type: GatewayEventType;

  @ApiPropertyOptional({ default: 1, description: 'Enviar el MISMO evento N veces en paralelo' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  deliveries?: number;

  @ApiPropertyOptional({ description: 'Forzar otro monto para probar amount_mismatch' })
  @IsOptional()
  @IsInt()
  @Min(1)
  amountOverride?: number;
}

/**
 * Solo para desarrollo/demo (ENABLE_SIMULATOR=true). Hace de pasarela que envía webhooks
 * firmados y de comercio que recibe las notificaciones del outbox.
 */
@ApiTags('simulator (solo dev)')
@Controller('simulator')
export class SimulatorController {
  private readonly merchantInbox: Array<{ receivedAt: string; eventId: string; body: unknown }> =
    [];

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: AppConfig,
  ) {}

  @Post('gateway/payments/:id/events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Simular que la pasarela envía un webhook firmado (opcionalmente duplicado)',
  })
  async sendGatewayEvent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SimulateEventDto,
    @Req() req: Request,
  ) {
    const payment = await this.db.query.payments.findFirst({ where: eq(payments.id, id) });
    if (!payment)
      throw new ApiError(HttpStatus.NOT_FOUND, 'PAYMENT_NOT_FOUND', 'Pago no encontrado');

    const body = JSON.stringify({
      id: `evt_${randomUUID()}`,
      type: dto.type,
      createdAt: new Date().toISOString(),
      data: {
        shopProcessId: payment.id,
        amount: dto.amountOverride ?? payment.amount,
        currency: payment.currency,
      },
    });
    const signature = signPayload(
      this.config.gatewayWebhookSecret,
      body,
      Math.floor(Date.now() / 1000),
    );
    const url = `${req.protocol}://${req.get('host')}/webhooks/gateway`;

    const responses = await Promise.all(
      Array.from({ length: dto.deliveries ?? 1 }, async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [GATEWAY_SIGNATURE_HEADER]: signature },
          body,
        });
        return { status: res.status, body: await res.json() };
      }),
    );
    return { sent: JSON.parse(body), responses };
  }

  @Post('merchant/webhooks')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Endpoint de ejemplo del comercio: verifica firma y guarda en memoria' })
  receiveMerchantWebhook(@Req() req: RawBodyRequest<Request>) {
    const check = verifySignature({
      secret: this.config.merchantWebhookSecret,
      rawBody: req.rawBody ?? Buffer.alloc(0),
      header: req.header(MERCHANT_SIGNATURE_HEADER),
      toleranceSeconds: 300,
    });
    if (!check.valid)
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_SIGNATURE', check.reason);

    const eventId = req.header('x-event-id') ?? 'unknown';
    // El comercio deduplica por x-event-id (la entrega es at-least-once).
    if (!this.merchantInbox.some((e) => e.eventId === eventId)) {
      this.merchantInbox.unshift({ receivedAt: new Date().toISOString(), eventId, body: req.body });
      this.merchantInbox.splice(100);
    }
    return { ok: true };
  }

  @Get('merchant/webhooks')
  @ApiOperation({ summary: 'Ver las notificaciones que recibió el comercio' })
  listMerchantWebhooks() {
    return this.merchantInbox;
  }
}
