import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { catchError, from, mergeMap, Observable } from 'rxjs';
import { ApiError } from '../common/errors';
import { sha256, stableStringify } from '../common/stable-hash';
import { IdempotencyService } from './idempotency.service';
import { IdempotentReplay } from './idempotent-replay';

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,255}$/;

/**
 * Se aplica con @UseInterceptors(IdempotencyInterceptor) en endpoints que crean efectos
 * (cobros, reembolsos). Exige el header Idempotency-Key.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly reflector: Reflector,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();

    const key = req.header('idempotency-key');
    if (!key || !KEY_PATTERN.test(key)) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Header Idempotency-Key obligatorio (8-255 caracteres: letras, números, - _ : .)',
      );
    }

    const scope = `${req.method} ${req.path}`;
    const requestHash = sha256(stableStringify(req.body ?? {}));
    const successCode =
      this.reflector.get<number>(HTTP_CODE_METADATA, ctx.getHandler()) ??
      (req.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);

    const claim$ = this.idempotency.claim(scope, key, requestHash).catch((err: unknown) => {
      if (err instanceof HttpException && err.getStatus() === HttpStatus.CONFLICT) {
        res.setHeader('Retry-After', '1');
      }
      throw err;
    });

    return from(claim$).pipe(
      mergeMap((claim) => {
        if (claim.kind === 'replay') {
          res.setHeader('Idempotent-Replayed', 'true');
          throw new IdempotentReplay(claim.statusCode, claim.body);
        }
        return next.handle().pipe(
          mergeMap(async (body) => {
            await this.idempotency.complete(scope, key, successCode, body);
            return body;
          }),
          catchError(async (err: unknown) => {
            const status = err instanceof HttpException ? err.getStatus() : 500;
            if (status < 500) {
              // Errores del cliente son deterministas: se guardan para devolver lo mismo.
              await this.idempotency.complete(
                scope,
                key,
                status,
                (err as HttpException).getResponse(),
              );
            } else {
              // Errores del servidor/pasarela: se libera la clave para permitir reintentos.
              await this.idempotency.release(scope, key);
            }
            throw err;
          }),
        );
      }),
    );
  }
}
