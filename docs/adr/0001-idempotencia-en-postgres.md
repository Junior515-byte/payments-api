# ADR-0001: Claves de idempotencia en PostgreSQL

- **Estado:** Aceptada
- **Contexto:** los clientes reintentan por timeouts, doble click o redes móviles. Un `POST /payments` repetido no puede generar dos cobros.

## Opciones

1. **Redis `SET key NX EX`**: muy rápido, pero el resultado de la operación vive en otro sistema. Si Redis pierde datos (failover, eviction), la protección desaparece en silencio.
2. **Tabla en PostgreSQL con PK `(scope, key)`**: la misma base que los pagos, con durabilidad y backups ya resueltos.
3. **Solo constraint única en el dominio** (`merchant_order_id`): protege contra duplicados, pero no devuelve la misma respuesta ni detecta claves reutilizadas con otro body.

## Decisión

Opción 2, sumando la 3 como defensa en profundidad.

- `INSERT` con PK única para reservar la clave: la base resuelve la carrera sin locks de aplicación.
- Se guarda el hash del body (claves ordenadas) → `422` si se reutiliza con otro contenido.
- Se guarda status y body de la respuesta como texto JSON exacto, y el replay devuelve los mismos bytes.
- 4xx se guardan (deterministas); 5xx liberan la clave (el cliente debe poder reintentar).
- Takeover de claves huérfanas tras `IDEMPOTENCY_LOCK_TIMEOUT_SECONDS` con compare-and-set sobre `locked_at`.
- Un job borra las claves vencidas (`IDEMPOTENCY_TTL_HOURS`, 24 h por defecto).

## Consecuencias

- (+) Una pieza de infraestructura menos. Mismas garantías que los datos de negocio.
- (+) Fácil de testear con concurrencia real (test e2e con 20 requests en paralelo).
- (−) Un `INSERT` extra por request. Aceptable para el volumen esperado. Si se vuelve un cuello de botella, la interfaz `IdempotencyService` permite cambiar a Redis sin tocar los controllers.
- (−) La reserva de la clave y la creación del pago no están en la misma transacción. Si el proceso muere en el medio, el reintento posterior al timeout re-ejecuta el handler, y la constraint `merchant_order_id` evita el duplicado.
