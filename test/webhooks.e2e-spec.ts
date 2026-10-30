import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ExpirePaymentsJob } from '../src/jobs/expire-payments.job';
import { PaymentTransitionsService } from '../src/payments/payment-transitions.service';
import {
  countRows,
  createPayment,
  createTestApp,
  gatewayEvent,
  newOrder,
  resetDb,
  sendWebhook,
  TestContext,
} from './helpers';

describe('Webhooks de la pasarela', () => {
  let ctx: TestContext;
  let paymentId: string;

  const status = async () => (await request(ctx.url).get(`/payments/${paymentId}`)).body.status;
  const event = (type: string, amount = 150_000) =>
    gatewayEvent(type, { shopProcessId: paymentId, amount });

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.app.close());
  beforeEach(async () => {
    await resetDb(ctx.db);
    paymentId = (await createPayment(ctx.url, newOrder()).expect(201)).body.id;
  });

  describe('seguridad', () => {
    it('rechaza firma inválida con 401 y no toca el pago', async () => {
      const res = await sendWebhook(ctx.url, event('payment.approved'), { secret: 'otro' }).expect(
        401,
      );
      expect(res.body.error).toBe('INVALID_SIGNATURE');
      expect(await status()).toBe('PENDING');
    });

    it('rechaza webhooks viejos (replay attack)', async () => {
      const old = Math.floor(Date.now() / 1000) - 3600;
      await sendWebhook(ctx.url, event('payment.approved'), { timestamp: old }).expect(401);
    });

    it('rechaza requests sin firma antes de validar el body', async () => {
      await request(ctx.url).post('/webhooks/gateway').send({}).expect(401);
    });
  });

  it('payment.approved aprueba el pago y encola la notificación', async () => {
    const res = await sendWebhook(ctx.url, event('payment.approved')).expect(200);
    expect(res.body).toEqual({ received: true, result: 'APPLIED' });
    expect(await status()).toBe('APPROVED');
    expect(await countRows(ctx.db, 'outbox_events', `type = 'payment.approved'`)).toBe(1);
  });

  it('el MISMO evento entregado 5 veces en paralelo se procesa una sola vez', async () => {
    const evt = event('payment.approved');
    const responses = await Promise.all(Array.from({ length: 5 }, () => sendWebhook(ctx.url, evt)));

    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(responses.filter((r) => r.body.result === 'APPLIED')).toHaveLength(1);
    expect(responses.filter((r) => r.body.duplicate)).toHaveLength(4);
    expect(await countRows(ctx.db, 'payment_transitions', `"to" = 'APPROVED'`)).toBe(1);
    expect(await countRows(ctx.db, 'outbox_events', `type = 'payment.approved'`)).toBe(1);
  });

  it('eventos fuera de orden: "rejected" después de "approved" se ignora', async () => {
    await sendWebhook(ctx.url, event('payment.approved')).expect(200);
    const res = await sendWebhook(ctx.url, event('payment.rejected')).expect(200);
    expect(res.body).toMatchObject({ result: 'IGNORED', reason: 'stale_event_for_approved' });
    expect(await status()).toBe('APPROVED');
  });

  it('monto distinto al del pago -> se ignora (amount_mismatch)', async () => {
    const res = await sendWebhook(ctx.url, event('payment.approved', 1)).expect(200);
    expect(res.body).toMatchObject({ result: 'IGNORED', reason: 'amount_mismatch' });
    expect(await status()).toBe('PENDING');
  });

  it('pago desconocido -> 200 ignorado (no provoca reintentos infinitos)', async () => {
    const res = await sendWebhook(
      ctx.url,
      gatewayEvent('payment.approved', { shopProcessId: randomUUID(), amount: 1 }),
    ).expect(200);
    expect(res.body).toMatchObject({ result: 'IGNORED', reason: 'unknown_payment' });
  });

  it('body inválido con firma válida -> 400', async () => {
    await sendWebhook(ctx.url, { id: 'evt_x', type: 'payment.hacked' }).expect(400);
  });

  it('aprobación tardía: un pago EXPIRED pasa a APPROVED y se marca lateApproval', async () => {
    const job = new ExpirePaymentsJob(ctx.db, ctx.app.get(PaymentTransitionsService));
    expect(await job.runOnce(new Date(Date.now() + 60 * 60_000))).toBe(1);
    expect(await status()).toBe('EXPIRED');

    await sendWebhook(ctx.url, event('payment.approved')).expect(200);
    const res = await request(ctx.url).get(`/payments/${paymentId}`);
    expect(res.body.status).toBe('APPROVED');
    expect(res.body.history.at(-1)).toMatchObject({
      from: 'EXPIRED',
      reason: 'approved_after_expiry',
    });
    expect(await countRows(ctx.db, 'outbox_events', `payload->>'lateApproval' = 'true'`)).toBe(1);
  });

  it('el job de expiración no toca pagos ya aprobados', async () => {
    await sendWebhook(ctx.url, event('payment.approved')).expect(200);
    const job = new ExpirePaymentsJob(ctx.db, ctx.app.get(PaymentTransitionsService));
    expect(await job.runOnce(new Date(Date.now() + 60 * 60_000))).toBe(0);
    expect(await status()).toBe('APPROVED');
  });

  describe('reembolsos', () => {
    const refund = (key = randomUUID()) =>
      request(ctx.url).post(`/payments/${paymentId}/refund`).set('Idempotency-Key', key).send({});

    it('flujo completo: APPROVED -> REFUND_PENDING -> REFUNDED', async () => {
      await sendWebhook(ctx.url, event('payment.approved')).expect(200);
      const res = await refund().expect(202);
      expect(res.body.status).toBe('REFUND_PENDING');

      await sendWebhook(ctx.url, event('refund.succeeded')).expect(200);
      expect(await status()).toBe('REFUNDED');
    });

    it('no se puede reembolsar un pago PENDING', async () => {
      const res = await refund().expect(409);
      expect(res.body.error).toBe('INVALID_STATE_TRANSITION');
    });

    it('doble click en "Reembolsar" con la misma clave: un solo reembolso', async () => {
      await sendWebhook(ctx.url, event('payment.approved')).expect(200);
      const key = randomUUID();
      await refund(key).expect(202);
      await refund(key).expect(202).expect('idempotent-replayed', 'true');
      expect(await countRows(ctx.db, 'payment_transitions', `"to" = 'REFUND_PENDING'`)).toBe(1);
    });

    it('si la pasarela rechaza el pedido de reembolso, se compensa a APPROVED', async () => {
      await sendWebhook(ctx.url, event('payment.approved')).expect(200);
      ctx.gateway.failureRate = 1;
      await refund().expect(502);
      ctx.gateway.failureRate = 0;
      expect(await status()).toBe('APPROVED');
      expect(await countRows(ctx.db, 'outbox_events', `type = 'payment.refund_failed'`)).toBe(1);
    });

    it('refund.failed vuelve el pago a APPROVED', async () => {
      await sendWebhook(ctx.url, event('payment.approved')).expect(200);
      await refund().expect(202);
      await sendWebhook(ctx.url, event('refund.failed')).expect(200);
      expect(await status()).toBe('APPROVED');
    });
  });
});
