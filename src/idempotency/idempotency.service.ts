import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AppConfig } from '../config/app-config';
import { ApiError } from '../common/errors';
import { DATABASE, Database, isUniqueViolation } from '../db/database';
import { idempotencyKeys } from '../db/schema';

export type ClaimResult =
  | { kind: 'claimed' }
  | { kind: 'replay'; statusCode: number; body: unknown };

/**
 * Implementa claves de idempotencia sobre PostgreSQL:
 *  - La PK (scope, key) garantiza que solo UNA request "gana" el lock, aunque lleguen en paralelo.
 *  - Si la misma clave llega con otro body -> 422 (el cliente reutilizó la clave por error).
 *  - Si la primera request sigue en curso -> 409 con Retry-After.
 *  - Si terminó -> se devuelve exactamente la misma respuesta (replay).
 *  - Si quedó colgada (proceso caído) más de lockTimeout -> otra request puede tomarla.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: AppConfig,
  ) {}

  async claim(
    scope: string,
    key: string,
    requestHash: string,
    now = new Date(),
  ): Promise<ClaimResult> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.db.insert(idempotencyKeys).values({
          scope,
          key,
          requestHash,
          status: 'IN_PROGRESS',
          lockedAt: now,
          expiresAt: new Date(now.getTime() + this.config.idempotencyTtlHours * 3_600_000),
        });
        return { kind: 'claimed' };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }

      const [existing] = await this.db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
      if (!existing) continue; // fue borrada entre el insert y el select: reintentar

      if (existing.expiresAt <= now) {
        await this.release(scope, key);
        continue;
      }

      if (existing.requestHash !== requestHash) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'IDEMPOTENCY_KEY_REUSED',
          'La Idempotency-Key ya se usó con un cuerpo de request distinto',
        );
      }

      if (existing.status === 'COMPLETED') {
        return {
          kind: 'replay',
          statusCode: existing.responseCode!,
          body: existing.responseBody === null ? null : JSON.parse(existing.responseBody),
        };
      }

      const lockAgeMs = now.getTime() - existing.lockedAt.getTime();
      if (lockAgeMs > this.config.idempotencyLockTimeoutSeconds * 1000) {
        // Takeover con compare-and-set sobre locked_at: solo un proceso lo logra.
        const taken = await this.db
          .update(idempotencyKeys)
          .set({ lockedAt: now })
          .where(
            and(
              eq(idempotencyKeys.scope, scope),
              eq(idempotencyKeys.key, key),
              eq(idempotencyKeys.status, 'IN_PROGRESS'),
              eq(idempotencyKeys.lockedAt, existing.lockedAt),
            ),
          )
          .returning({ key: idempotencyKeys.key });
        if (taken.length === 1) return { kind: 'claimed' };
      }

      throw new ApiError(
        HttpStatus.CONFLICT,
        'IDEMPOTENCY_REQUEST_IN_PROGRESS',
        'Hay una request con esta Idempotency-Key en curso; reintentá en unos segundos',
        { retryAfterSeconds: 1 },
      );
    }
    throw new ApiError(HttpStatus.CONFLICT, 'IDEMPOTENCY_CONFLICT', 'No se pudo reservar la clave');
  }

  async complete(scope: string, key: string, statusCode: number, body: unknown): Promise<void> {
    await this.db
      .update(idempotencyKeys)
      .set({
        status: 'COMPLETED',
        responseCode: statusCode,
        responseBody: body === undefined ? null : JSON.stringify(body),
      })
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
  }

  /** Libera la clave (errores 5xx): el cliente puede reintentar con la misma clave. */
  async release(scope: string, key: string): Promise<void> {
    await this.db
      .delete(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
  }
}
