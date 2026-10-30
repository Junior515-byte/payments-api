import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { OutboxDispatcher } from '../outbox/outbox.dispatcher';
import { CleanupIdempotencyJob } from './cleanup-idempotency.job';
import { ExpirePaymentsJob } from './expire-payments.job';

/**
 * Loop simple con setTimeout encadenado: una ejecución nunca se solapa con la siguiente
 * y el apagado espera a que termine la que está en curso (graceful shutdown).
 */
@Injectable()
export class Scheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(Scheduler.name);
  private stopping = false;
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly running = new Set<Promise<unknown>>();

  constructor(
    private readonly config: AppConfig,
    private readonly outbox: OutboxDispatcher,
    private readonly expire: ExpirePaymentsJob,
    private readonly cleanup: CleanupIdempotencyJob,
  ) {}

  onApplicationBootstrap(): void {
    this.every('outbox', this.config.outboxPollIntervalMs, () => this.outbox.runOnce());
    this.every('expire-payments', this.config.expirationIntervalMs, () => this.expire.runOnce());
    this.every('cleanup-idempotency', 60 * 60_000, () => this.cleanup.runOnce());
    this.logger.log('Worker iniciado');
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.timers.forEach(clearTimeout);
    await Promise.allSettled([...this.running]);
  }

  private every(name: string, intervalMs: number, job: () => Promise<unknown>): void {
    const tick = async () => {
      if (this.stopping) return;
      const run = job().catch((err) =>
        this.logger.error({ job: name, err: String(err) }, 'Job falló'),
      );
      this.running.add(run);
      await run;
      this.running.delete(run);
      if (!this.stopping) this.schedule(tick, intervalMs);
    };
    this.schedule(tick, 0);
  }

  private schedule(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }
}
