import { sql } from 'drizzle-orm';
import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { verifySignature } from '../src/common/signature';
import { AppConfig } from '../src/config/app-config';
import { OutboxDispatcher } from '../src/outbox/outbox.dispatcher';
import { countRows, createPayment, createTestApp, newOrder, resetDb, TestContext } from './helpers';

interface Received {
  headers: IncomingMessage['headers'];
  body: string;
}

describe('Outbox dispatcher', () => {
  let ctx: TestContext;
  let server: Server;
  let merchantUrl: string;
  let received: Received[];
  let respondWith: number;

  const dispatcher = (env: Record<string, string> = {}) =>
    new OutboxDispatcher(
      ctx.db,
      new AppConfig({
        ...process.env,
        MERCHANT_WEBHOOK_URL: merchantUrl,
        OUTBOX_MAX_ATTEMPTS: '3',
        ...env,
      }),
    );
  const makeDue = () => ctx.db.execute(sql`UPDATE outbox_events SET next_attempt_at = now()`);

  beforeAll(async () => {
    ctx = await createTestApp();
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.writeHead(respondWith).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    merchantUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hooks`;
  });
  afterAll(async () => {
    await ctx.app.close();
    await new Promise((r) => server.close(r));
  });
  beforeEach(async () => {
    received = [];
    respondWith = 200;
    await resetDb(ctx.db);
    await createPayment(ctx.url, newOrder()).expect(201); // genera payment.created
  });

  it('entrega el evento firmado con HMAC y lo marca SENT', async () => {
    expect(await dispatcher().runOnce()).toEqual({ sent: 1, failed: 0 });

    expect(received).toHaveLength(1);
    const [msg] = received;
    expect(JSON.parse(msg.body)).toMatchObject({
      type: 'payment.created',
      data: { status: 'PENDING' },
    });
    expect(msg.headers['x-event-id']).toBeTruthy();
    expect(
      verifySignature({
        secret: process.env.MERCHANT_WEBHOOK_SECRET!,
        rawBody: msg.body,
        header: msg.headers['x-signature'] as string,
        toleranceSeconds: 60,
      }),
    ).toEqual({ valid: true });
    expect(await countRows(ctx.db, 'outbox_events', `status = 'SENT'`)).toBe(1);
  });

  it('si el comercio falla, reprograma con backoff y no reenvía antes de tiempo', async () => {
    respondWith = 500;
    expect(await dispatcher().runOnce()).toEqual({ sent: 0, failed: 1 });
    expect(
      await countRows(ctx.db, 'outbox_events', `status = 'PENDING' AND next_attempt_at > now()`),
    ).toBe(1);
    expect(await dispatcher().runOnce()).toEqual({ sent: 0, failed: 0 });

    respondWith = 200;
    await makeDue();
    expect(await dispatcher().runOnce()).toEqual({ sent: 1, failed: 0 });
    expect(await countRows(ctx.db, 'outbox_events', `status = 'SENT' AND attempts = 2`)).toBe(1);
  });

  it('tras agotar los reintentos el evento queda DEAD', async () => {
    respondWith = 503;
    for (let i = 0; i < 3; i++) {
      await makeDue();
      await dispatcher().runOnce();
    }
    expect(
      await countRows(ctx.db, 'outbox_events', `status = 'DEAD' AND last_error = 'HTTP 503'`),
    ).toBe(1);
  });

  it('varios workers en paralelo no entregan el mismo evento dos veces (SKIP LOCKED)', async () => {
    for (let i = 0; i < 9; i++) await createPayment(ctx.url, newOrder()).expect(201);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => dispatcher({ OUTBOX_BATCH_SIZE: '3' }).runOnce()),
    );

    const ids = received.map((r) => r.headers['x-event-id']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });
});
