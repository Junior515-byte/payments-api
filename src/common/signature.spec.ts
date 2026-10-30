import { signPayload, verifySignature } from './signature';

describe('webhook signature', () => {
  const secret = 'test-secret';
  const body = '{"id":"evt_1","type":"payment.approved"}';
  const now = 1_800_000_000;

  it('acepta una firma válida', () => {
    const header = signPayload(secret, body, now);
    expect(
      verifySignature({ secret, rawBody: body, header, toleranceSeconds: 300, nowSeconds: now }),
    ).toEqual({
      valid: true,
    });
  });

  it('rechaza si el body fue modificado (un solo byte)', () => {
    const header = signPayload(secret, body, now);
    const tampered = body.replace('approved', 'approveD');
    expect(
      verifySignature({
        secret,
        rawBody: tampered,
        header,
        toleranceSeconds: 300,
        nowSeconds: now,
      }),
    ).toEqual({ valid: false, reason: 'mismatch' });
  });

  it('rechaza firmas con otro secreto', () => {
    const header = signPayload('otro-secreto', body, now);
    expect(
      verifySignature({ secret, rawBody: body, header, toleranceSeconds: 300, nowSeconds: now })
        .valid,
    ).toBe(false);
  });

  it('rechaza timestamps fuera de tolerancia (replay attack)', () => {
    const header = signPayload(secret, body, now - 301);
    expect(
      verifySignature({ secret, rawBody: body, header, toleranceSeconds: 300, nowSeconds: now }),
    ).toEqual({
      valid: false,
      reason: 'expired',
    });
  });

  it.each([
    [undefined, 'missing'],
    ['basura', 'malformed'],
    ['t=abc,v1=00', 'malformed'],
  ])('header %p -> %p', (header, reason) => {
    expect(
      verifySignature({ secret, rawBody: body, header, toleranceSeconds: 300, nowSeconds: now }),
    ).toEqual({
      valid: false,
      reason,
    });
  });
});
