import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './db/database.module';
import { CleanupIdempotencyJob } from './jobs/cleanup-idempotency.job';
import { ExpirePaymentsJob } from './jobs/expire-payments.job';
import { Scheduler } from './jobs/scheduler';
import { loggingModule } from './logging';
import { OutboxDispatcher } from './outbox/outbox.dispatcher';
import { PaymentsModule } from './payments/payments.module';

/** Proceso separado de la API: escala de forma independiente y no compite por CPU con HTTP. */
@Module({
  imports: [loggingModule, ConfigModule, DatabaseModule, PaymentsModule],
  providers: [OutboxDispatcher, ExpirePaymentsJob, CleanupIdempotencyJob, Scheduler],
})
export class WorkerModule {}
