import { stableStringify } from './stable-hash';

describe('stableStringify', () => {
  it('no depende del orden de las claves', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { y: 1, x: 2 }] } })).toBe(
      stableStringify({ a: { c: [3, { x: 2, y: 1 }], d: 2 }, b: 1 }),
    );
  });

  it('ignora claves undefined como JSON.stringify', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});
