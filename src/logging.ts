import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

/** Logs JSON estructurados con request id (x-request-id) para correlacionar en producción. */
export const loggingModule = LoggerModule.forRoot({
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? 'info',
    genReqId: (req, res) => {
      const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    redact: ['req.headers.authorization', 'req.headers["x-gateway-signature"]'],
    autoLogging: { ignore: (req) => req.url === '/health' },
    transport:
      process.env.LOG_PRETTY === 'true'
        ? { target: 'pino-pretty', options: { singleLine: true } }
        : undefined,
  },
});
