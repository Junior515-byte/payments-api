import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GatewayWebhookDto } from './dto/gateway-webhook.dto';
import { GATEWAY_SIGNATURE_HEADER, WebhookSignatureGuard } from './webhook-signature.guard';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  /**
   * Siempre responde 200 a eventos con firma válida (incluso ignorados o duplicados),
   * para que la pasarela no reintente indefinidamente. Solo responde 5xx si algo falló
   * de nuestro lado y SÍ queremos el reintento.
   */
  @Post('gateway')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WebhookSignatureGuard)
  @ApiHeader({ name: GATEWAY_SIGNATURE_HEADER, description: 't=<unix>,v1=<hmac-sha256>' })
  @ApiOperation({ summary: 'Webhook de la pasarela (firmado con HMAC)' })
  handle(@Body() event: GatewayWebhookDto) {
    return this.webhooks.process(event);
  }
}
