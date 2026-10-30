import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './db/database.module';
import { HealthController } from './health/health.controller';
import { loggingModule } from './logging';
import { PaymentsModule } from './payments/payments.module';
import { SimulatorModule } from './simulator/simulator.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    loggingModule,
    ConfigModule,
    DatabaseModule,
    PaymentsModule,
    WebhooksModule,
    ...(process.env.ENABLE_SIMULATOR === 'true' ? [SimulatorModule] : []),
  ],
  controllers: [HealthController],
})
export class AppModule {}
