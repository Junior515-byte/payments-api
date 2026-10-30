/**
 * Configuración tipada leída de variables de entorno.
 * Falla rápido al arrancar si falta algo obligatorio.
 */
export class AppConfig {
  readonly nodeEnv: string;
  readonly port: number;
  readonly logLevel: string;
  readonly databaseUrl: string;

  readonly gatewayWebhookSecret: string;
  readonly gatewayCheckoutBaseUrl: string;
  readonly gatewayFailureRate: number;
  readonly webhookToleranceSeconds: number;

  readonly merchantWebhookUrl: string;
  readonly merchantWebhookSecret: string;
  readonly outboxPollIntervalMs: number;
  readonly outboxBatchSize: number;
  readonly outboxMaxAttempts: number;

  readonly paymentTtlMinutes: number;
  readonly expirationIntervalMs: number;
  readonly idempotencyTtlHours: number;
  readonly idempotencyLockTimeoutSeconds: number;

  readonly enableSimulator: boolean;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.nodeEnv = env.NODE_ENV ?? 'development';
    this.port = int(env, 'PORT', 3000);
    this.logLevel = env.LOG_LEVEL ?? 'info';
    this.databaseUrl = required(env, 'DATABASE_URL');

    this.gatewayWebhookSecret = required(env, 'GATEWAY_WEBHOOK_SECRET');
    this.gatewayCheckoutBaseUrl =
      env.GATEWAY_CHECKOUT_BASE_URL ?? 'https://checkout.gateway.test/pay';
    this.gatewayFailureRate = Number(env.GATEWAY_FAILURE_RATE ?? 0);
    this.webhookToleranceSeconds = int(env, 'WEBHOOK_TOLERANCE_SECONDS', 300);

    this.merchantWebhookUrl = required(env, 'MERCHANT_WEBHOOK_URL');
    this.merchantWebhookSecret = required(env, 'MERCHANT_WEBHOOK_SECRET');
    this.outboxPollIntervalMs = int(env, 'OUTBOX_POLL_INTERVAL_MS', 1000);
    this.outboxBatchSize = int(env, 'OUTBOX_BATCH_SIZE', 20);
    this.outboxMaxAttempts = int(env, 'OUTBOX_MAX_ATTEMPTS', 8);

    this.paymentTtlMinutes = int(env, 'PAYMENT_TTL_MINUTES', 15);
    this.expirationIntervalMs = int(env, 'EXPIRATION_INTERVAL_MS', 30_000);
    this.idempotencyTtlHours = int(env, 'IDEMPOTENCY_TTL_HOURS', 24);
    this.idempotencyLockTimeoutSeconds = int(env, 'IDEMPOTENCY_LOCK_TIMEOUT_SECONDS', 30);

    this.enableSimulator = (env.ENABLE_SIMULATOR ?? 'false') === 'true';
    if (this.enableSimulator && this.nodeEnv === 'production') {
      throw new Error('ENABLE_SIMULATOR no puede estar activo en producción');
    }
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Falta la variable de entorno obligatoria ${name}`);
  return value;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} debe ser un entero >= 0`);
  return value;
}
