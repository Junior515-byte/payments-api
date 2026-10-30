import { backoffDelayMs } from './backoff';

describe('backoffDelayMs', () => {
  const min = () => 0;
  const max = () => 1;

  it('crece exponencialmente', () => {
    expect([1, 2, 3, 4].map((a) => backoffDelayMs(a, { baseMs: 1000, random: max }))).toEqual([
      1000, 2000, 4000, 8000,
    ]);
  });

  it('el jitter mantiene al menos la mitad del delay', () => {
    expect(backoffDelayMs(3, { baseMs: 1000, random: min })).toBe(2000);
  });

  it('respeta el máximo', () => {
    expect(backoffDelayMs(50, { baseMs: 1000, maxMs: 60_000, random: max })).toBe(60_000);
  });
});
