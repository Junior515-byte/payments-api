/** Variables de entorno para e2e. DATABASE_URL se puede sobreescribir (CI). */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/payments_test',
  GATEWAY_WEBHOOK_SECRET: 'test-gateway-secret',
  MERCHANT_WEBHOOK_URL: 'http://127.0.0.1:9/unused',
  MERCHANT_WEBHOOK_SECRET: 'test-merchant-secret',
  GATEWAY_FAILURE_RATE: '0',
  ENABLE_SIMULATOR: 'false',
};
for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v;
