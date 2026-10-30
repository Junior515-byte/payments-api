/**
 * Backoff exponencial con "equal jitter": la mitad del delay es fija y la otra mitad aleatoria.
 * Evita que miles de reintentos golpeen al comercio al mismo tiempo (thundering herd).
 */
export function backoffDelayMs(
  attempt: number,
  opts: { baseMs?: number; maxMs?: number; random?: () => number } = {},
): number {
  const baseMs = opts.baseMs ?? 2_000;
  const maxMs = opts.maxMs ?? 10 * 60_000;
  const random = opts.random ?? Math.random;
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const half = exp / 2;
  return Math.round(half + random() * half);
}
