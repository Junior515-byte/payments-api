import { Module } from '@nestjs/common';
import { FakeGatewayClient } from '../gateway/fake-gateway.client';
import { GATEWAY_CLIENT } from '../gateway/gateway.client';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { OutboxModule } from '../outbox/outbox.module';
import { PaymentTransitionsService } from './payment-transitions.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [IdempotencyModule, OutboxModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentTransitionsService,
    // En producción se reemplaza por BancardGatewayClient sin tocar el dominio.
    { provide: GATEWAY_CLIENT, useClass: FakeGatewayClient },
  ],
  exports: [PaymentTransitionsService, GATEWAY_CLIENT],
})
export class PaymentsModule {}
