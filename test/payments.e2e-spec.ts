import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { countRows, createPayment, createTestApp, newOrder, resetDb, TestContext } from './helpers';

describe('POST /payments (idempotencia)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.app.close());
  beforeEach(async () => {
    ctx.gateway.failureRate = 0;
    await resetDb(ctx.db);
  });

  it('crea un pago PENDING con URL de checkout', async () => {
    const res = await createPayment(ctx.url, newOrder()).expect(201);
    expect(res.body).toMatchObject({ status: 'PENDING', amount: 150000, currency: 'PYG' });
    expect(res.body.checkoutUrl).toMatch(/^https:\/\//);
  });

  it('exige Idempotency-Key', async () => {
    const res = await request(ctx.url).post('/payments').send(newOrder()).expect(400);
    expect(res.body.error).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('valida el body', async () => {
    const res = await createPayment(ctx.url, newOrder({ amount: 10.5 })).expect(400);
    expect(res.body.message).toEqual(expect.arrayContaining([expect.stringMatching(/amount/)]));
    expect(await countRows(ctx.db, 'payments')).toBe(0);
  });

  it('un reintento con la misma clave devuelve la MISMA respuesta sin crear otro pago', async () => {
    const key = randomUUID();
    const order = newOrder();
    const first = await createPayment(ctx.url, order, key).expect(201);
    const retry = await createPayment(ctx.url, order, key).expect(201);

    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.text).toBe(first.text);
    expect(await countRows(ctx.db, 'payments')).toBe(1);
  });

  it('el orden de las claves del JSON no importa para el hash', async () => {
    const key = randomUUID();
    await createPayment(
      ctx.url,
      { merchantOrderId: 'ORD-X', amount: 5000, currency: 'PYG' },
      key,
    ).expect(201);
    await createPayment(ctx.url, { currency: 'PYG', amount: 5000, merchantOrderId: 'ORD-X' }, key)
      .expect(201)
      .expect('idempotent-replayed', 'true');
  });

  it('misma clave con otro body -> 422', async () => {
    const key = randomUUID();
    await createPayment(ctx.url, newOrder(), key).expect(201);
    const res = await createPayment(ctx.url, newOrder({ amount: 1 }), key).expect(422);
    expect(res.body.error).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('20 requests concurrentes con la misma clave crean UN solo pago', async () => {
    const key = randomUUID();
    const order = newOrder();
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => createPayment(ctx.url, order, key)),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    const ok = responses.filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ok.map((r) => r.body.id)).size).toBe(1);
    // Exactamente UNA ejecutó el handler; las otras 19 fueron 409 (en curso) o replay.
    const notExecuted = responses.filter(
      (r) => r.status === 409 || r.headers['idempotent-replayed'] === 'true',
    );
    expect(notExecuted).toHaveLength(19);
    responses
      .filter((r) => r.status === 409)
      .forEach((r) => expect(r.headers['retry-after']).toBe('1'));
    expect(await countRows(ctx.db, 'payments')).toBe(1);
  });

  it('misma orden con DISTINTAS claves en paralelo: igual hay un solo pago (constraint única)', async () => {
    const order = newOrder();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => createPayment(ctx.url, order)),
    );
    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(await countRows(ctx.db, 'payments')).toBe(1);
  });

  it('misma orden con otro monto -> 409 MERCHANT_ORDER_CONFLICT', async () => {
    await createPayment(ctx.url, newOrder({ merchantOrderId: 'ORD-DUP' })).expect(201);
    const res = await createPayment(
      ctx.url,
      newOrder({ merchantOrderId: 'ORD-DUP', amount: 999 }),
    ).expect(409);
    expect(res.body.error).toBe('MERCHANT_ORDER_CONFLICT');
  });

  it('si la pasarela falla: 502, la clave se libera y el reintento completa el MISMO pago', async () => {
    const key = randomUUID();
    const order = newOrder();
    ctx.gateway.failureRate = 1;
    const failed = await createPayment(ctx.url, order, key).expect(502);
    expect(failed.body.error).toBe('GATEWAY_UNAVAILABLE');
    expect(await countRows(ctx.db, 'idempotency_keys')).toBe(0);

    ctx.gateway.failureRate = 0;
    const retry = await createPayment(ctx.url, order, key).expect(201);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    expect(retry.body.checkoutUrl).toBeTruthy();
    expect(await countRows(ctx.db, 'payments')).toBe(1);
  });

  it('GET /payments/:id devuelve el historial; 404 si no existe', async () => {
    const { body } = await createPayment(ctx.url, newOrder()).expect(201);
    const res = await request(ctx.url).get(`/payments/${body.id}`).expect(200);
    expect(res.body.history).toEqual([
      expect.objectContaining({ from: null, to: 'PENDING', source: 'api' }),
    ]);
    await request(ctx.url).get(`/payments/${randomUUID()}`).expect(404);
    await request(ctx.url).get('/payments/no-es-uuid').expect(400);
  });
});
