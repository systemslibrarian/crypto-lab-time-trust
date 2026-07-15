import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode, fromHex, timingSafeEqual, toHex } from './bytes';
import { decide } from './decision';

describe('byte helpers', () => {
  it('hex round-trips', () => {
    expect(toHex(fromHex('00ff10'))).toBe('00ff10');
    expect(() => fromHex('0g')).toThrow();
    expect(() => fromHex('abc')).toThrow();
  });
  it('base64url round-trips without padding', () => {
    const b = fromHex('fbff01');
    const s = b64urlEncode(b);
    expect(s).not.toContain('=');
    expect(s).not.toContain('+');
    expect([...b64urlDecode(s)]).toEqual([...b]);
    expect(() => b64urlDecode('a+b')).toThrow();
  });
  it('timingSafeEqual compares correctly', () => {
    expect(timingSafeEqual(fromHex('aabb'), fromHex('aabb'))).toBe(true);
    expect(timingSafeEqual(fromHex('aabb'), fromHex('aabc'))).toBe(false);
    expect(timingSafeEqual(fromHex('aabb'), fromHex('aa'))).toBe(false);
  });
});

describe('decide() fails closed', () => {
  const okC = { ok: true, label: 'sig', detail: '' };
  const badC = { ok: false, label: 'sig', detail: '' };
  const okP = { name: 'time', pass: true, detail: '' };
  const badP = { name: 'time', pass: false, detail: '' };
  it('accepts only when everything passes', () => {
    expect(decide([okC], [okP]).verdict).toBe('accept');
  });
  it('any crypto failure rejects', () => {
    expect(decide([badC], [okP]).verdict).toBe('reject');
  });
  it('any policy failure rejects, and the reason names it', () => {
    const d = decide([okC], [okP, badP]);
    expect(d.verdict).toBe('reject');
    expect(d.reason).toContain('policy');
  });
});
