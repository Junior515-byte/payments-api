import { HttpException, HttpStatus } from '@nestjs/common';

/** Error de dominio con código estable para que los clientes puedan reaccionar sin parsear texto. */
export class ApiError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, extra?: Record<string, unknown>) {
    super({ statusCode: status, error: code, message, ...extra }, status);
  }
}
