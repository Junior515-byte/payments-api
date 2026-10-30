# ADR-0002: Transactional Outbox para notificar al comercio

- **Estado:** Aceptada
- **Contexto:** cuando un pago cambia de estado, el comercio debe enterarse (para despachar, liberar stock, etc.). Es el problema de *dual write*: actualizar la base Y enviar un mensaje no es atómico.

## Opciones

1. **Enviar el webhook dentro del request/transacción:** si el comercio tarda, se retienen locks; si falla, ¿se hace rollback del pago aprobado? No tiene sentido.
2. **Enviar después del commit:** si el proceso muere entre el commit y el envío, el evento se pierde para siempre.
3. **Outbox:** insertar el evento en una tabla dentro de la misma transacción y publicarlo desde un proceso aparte.

## Decisión

Opción 3.

- `OutboxRepository.enqueue(tx, ...)` solo acepta una transacción abierta.
- El worker reclama lotes con `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING`, incrementa `attempts` y fija `locked_until` (lease de 30 s).
- El HTTP sale **fuera** de cualquier transacción.
- Éxito → `SENT`. Fallo → `next_attempt_at` con backoff exponencial y jitter. Tras `OUTBOX_MAX_ATTEMPTS` → `DEAD`.
- Notificaciones firmadas con HMAC y header `x-event-id` para que el comercio deduplique.

## Consecuencias

- (+) Garantía *at-least-once*: ningún cambio de estado queda sin notificar.
- (+) Escala horizontal: varios workers no se pisan gracias a `SKIP LOCKED`.
- (−) No hay orden garantizado entre eventos del mismo pago (se envían en paralelo y con reintentos). El payload incluye `status` y `createdAt`, y el comercio puede consultar `GET /payments/:id`. Si se necesitara orden estricto, se puede procesar secuencialmente por `aggregate_id`.
- (−) Latencia de hasta `OUTBOX_POLL_INTERVAL_MS`. Se podría reducir con `LISTEN/NOTIFY`.
- (−) La tabla crece: en producción hay que archivar los eventos `SENT` viejos.
