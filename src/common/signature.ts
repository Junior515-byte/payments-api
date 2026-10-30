import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Firma de webhooks estilo "t=<unix>,v1=<hmac>" (mismo esquema que usan Stripe y otros).
 * Se firma `${timestamp}.${rawBody}` para evitar ataques de replay con timestamps viejos.
 */
export function signPayload(secret: string, rawBody: string, timestamp: number): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

export type SignatureCheck =
  | { valid: true }
  | { valid: false; reason: 'missing' | 'malformed' | 'expired' | 'mismatch' };

export function verifySignature(params: {
  secret: string;
  rawBody: string | Buffer;
  header: string | undefined;
  toleranceSeconds: number;
  nowSeconds?: number;
}): SignatureCheck {
  const { secret, header, toleranceSeconds } = params;
  if (!header) return { valid: false, reason: 'missing' };

  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const [k, ...rest] = part.trim().split('=');
      return [k, rest.join('=')];
    }),
  );
  const timestamp = Number(parts.t);
  const provided = parts.v1;
  if (!Number.isInteger(timestamp) || !provided || !/^[0-9a-f]{64}$/.test(provided)) {
    return { valid: false, reason: 'malformed' };
  }

  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) return { valid: false, reason: 'expired' };

  const body =
    typeof params.rawBody === 'string' ? params.rawBody : params.rawBody.toString('utf8');
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  const actual = Buffer.from(provided, 'hex');
  // timingSafeEqual evita filtrar información por tiempo de comparación.
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { valid: false, reason: 'mismatch' };
  }
  return { valid: true };
}
