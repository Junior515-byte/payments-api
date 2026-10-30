import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

/** Señal interna para devolver una respuesta guardada con su status original. */
export class IdempotentReplay {
  constructor(
    readonly statusCode: number,
    readonly body: unknown,
  ) {}
}

@Catch(IdempotentReplay)
export class IdempotentReplayFilter implements ExceptionFilter {
  catch(replay: IdempotentReplay, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>().status(replay.statusCode).json(replay.body);
  }
}
