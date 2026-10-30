import { canTransition, isFinal } from './payment-state-machine';

describe('payment state machine', () => {
  it.each([
    ['PENDING', 'APPROVED'],
    ['PENDING', 'REJECTED'],
    ['PENDING', 'EXPIRED'],
    ['EXPIRED', 'APPROVED'],
    ['APPROVED', 'REFUND_PENDING'],
    ['REFUND_PENDING', 'REFUNDED'],
    ['REFUND_PENDING', 'APPROVED'],
  ] as const)('permite %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['APPROVED', 'REJECTED'],
    ['APPROVED', 'PENDING'],
    ['REJECTED', 'APPROVED'],
    ['REFUNDED', 'APPROVED'],
    ['EXPIRED', 'REJECTED'],
    ['PENDING', 'REFUNDED'],
  ] as const)('rechaza %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('REJECTED y REFUNDED son estados finales', () => {
    expect(isFinal('REJECTED')).toBe(true);
    expect(isFinal('REFUNDED')).toBe(true);
    expect(isFinal('APPROVED')).toBe(false);
  });
});
