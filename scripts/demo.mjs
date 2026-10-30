// Recorre los escenarios principales contra una API levantada (docker compose up).
// Uso: node scripts/demo.mjs [http://localhost:3000]   (funciona en Windows, macOS y Linux)
import { randomUUID } from 'node:crypto';

const API = process.argv[2] ?? 'http://localhost:3000';
const key = `demo-${randomUUID()}`;
const order = { merchantOrderId: `ORD-${Date.now()}`, amount: 150000, currency: 'PYG', description: 'Plan Pro' };

const step = (title) => console.log(`\n\x1b[1;36m== ${title} ==\x1b[0m`);
const show = (value) => console.log(JSON.stringify(value, null, 2));

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}
const simulate = (id, type, extra = {}) =>
  call('POST', `/simulator/gateway/payments/${id}/events`, { type, ...extra });

step(`1. Crear pago (Idempotency-Key: ${key})`);
const created = await call('POST', '/payments', order, { 'Idempotency-Key': key });
show(created.body);
const id = created.body.id;

step('2. Doble click: misma clave -> misma respuesta, sin crear otro pago');
const replay = await call('POST', '/payments', order, { 'Idempotency-Key': key });
console.log(`HTTP ${replay.status} | Idempotent-Replayed: ${replay.headers.get('idempotent-replayed')} | mismo id: ${replay.body.id === id}`);

step('3. Misma clave con otro monto -> 422');
show((await call('POST', '/payments', { ...order, amount: 1 }, { 'Idempotency-Key': key })).body);

step("4. La pasarela envía 'payment.approved' 3 veces en paralelo -> se aplica UNA");
(await simulate(id, 'payment.approved', { deliveries: 3 })).body.responses.forEach((r) => console.log(JSON.stringify(r.body)));

step("5. Evento fuera de orden: 'payment.rejected' después de aprobado -> ignorado");
console.log(JSON.stringify((await simulate(id, 'payment.rejected')).body.responses[0].body));

step('6. Webhook con firma falsa -> 401');
show((await call('POST', '/webhooks/gateway', {}, { 'x-gateway-signature': 't=1,v1=deadbeef' })).body);

step('7. Reembolso -> REFUND_PENDING, la pasarela confirma -> REFUNDED');
const refund = await call('POST', `/payments/${id}/refund`, {}, { 'Idempotency-Key': `refund-${key}` });
console.log(`HTTP ${refund.status} | status: ${refund.body.status}`);
await simulate(id, 'refund.succeeded');

step('8. Historial completo del pago');
show((await call('GET', `/payments/${id}`)).body);

step('9. Notificaciones que recibió el comercio (outbox, firmadas con HMAC)');
await new Promise((r) => setTimeout(r, 2500));
const inbox = (await call('GET', '/simulator/merchant/webhooks')).body
  .filter((e) => e.body.data.paymentId === id)
  .sort((a, b) => a.body.createdAt.localeCompare(b.body.createdAt));
inbox.forEach((e) => console.log(`${e.body.createdAt}  ${e.body.type}`));
