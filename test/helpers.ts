import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { signPayload } from '../src/common/signature';
import { DATABASE, Database } from '../src/db/database';
import { FakeGatewayClient } from '../src/gateway/fake-gateway.client';
import { GATEWAY_CLIENT } from '../src/gateway/gateway.client';

export interface TestContext {
  app: INestApplication;
  url: string;
  db: Database;
  gateway: FakeGatewayClient;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  return {
    app,
    url: await app.getUrl(),
    db: app.get(DATABASE),
    gateway: app.get<FakeGatewayClient>(GATEWAY_CLIENT),
  };
}

export async function resetDb(db: Database): Promise<void> {
  await db.execute(
    sql`TRUNCATE payments, payment_transitions, idempotency_keys, webhook_events, outbox_events CASCADE`,
  );
}

export function newOrder(overrides: Record<string, unknown> = {}) {
  return {
    merchantOrderId: `ORD-${randomUUID().slice(0, 8)}`,
    amount: 150_000,
    currency: 'PYG',
    description: 'Plan Pro',
    ...overrides,
  };
}

export function createPayment(url: string, body: object, key: string = randomUUID()) {
  return request(url).post('/payments').set('Idempotency-Key', key).send(body);
}

export function gatewayEvent(
  type: string,
  data: { shopProcessId: string; amount: number; currency?: string },
  id = `evt_${randomUUID()}`,
) {
  return {
    id,
    type,
    createdAt: new Date().toISOString(),
    data: { currency: 'PYG', ...data },
  };
}

export function sendWebhook(
  url: string,
  event: object,
  opts: { secret?: string; timestamp?: number } = {},
) {
  const body = JSON.stringify(event);
  const signature = signPayload(
    opts.secret ?? process.env.GATEWAY_WEBHOOK_SECRET!,
    body,
    opts.timestamp ?? Math.floor(Date.now() / 1000),
  );
  return request(url)
    .post('/webhooks/gateway')
    .set('content-type', 'application/json')
    .set('x-gateway-signature', signature)
    .send(body);
}

export async function countRows(db: Database, table: string, where = 'true'): Promise<number> {
  const res = await db.execute<{ n: number }>(
    sql.raw(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`),
  );
  return res.rows[0].n;
}
