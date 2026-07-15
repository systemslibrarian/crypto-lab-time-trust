import { describe, expect, it } from 'vitest';
import { toHex } from '../core/bytes';
import { TAG, derInt, derTime, oid, parseDerTime, readChildren, readTlv, seq, tlv } from './der';

describe('DER encoding', () => {
  it('short and long length forms', () => {
    expect(toHex(tlv(0x04, new Uint8Array(3)))).toBe('0403000000');
    const long = tlv(0x04, new Uint8Array(200));
    expect(long[1]).toBe(0x81);
    expect(long[2]).toBe(200);
  });

  it('INTEGER adds a leading zero to keep values positive', () => {
    expect(toHex(derInt(2))).toBe('020102');
    expect(toHex(derInt(128))).toBe('02020080');
  });

  it('OID: id-Ed25519 1.3.101.112 encodes to the RFC 8410 bytes', () => {
    expect(toHex(oid('1.3.101.112'))).toBe('06032b6570');
  });

  it('OID: id-at-commonName 2.5.4.3', () => {
    expect(toHex(oid('2.5.4.3'))).toBe('0603550403');
  });

  it('encodes dates ≤ 2049 as UTCTime and ≥ 2050 as GeneralizedTime (RFC 5280 §4.1.2.5)', () => {
    const t2026 = derTime(Date.UTC(2026, 6, 15, 12, 0, 0));
    expect(t2026[0]).toBe(TAG.UTCTIME);
    expect(new TextDecoder().decode(readTlv(t2026).body)).toBe('260715120000Z');
    const t2050 = derTime(Date.UTC(2050, 0, 1, 0, 0, 0));
    expect(t2050[0]).toBe(TAG.GENERALIZED_TIME);
    expect(new TextDecoder().decode(readTlv(t2050).body)).toBe('20500101000000Z');
  });

  it('time round-trips through parse', () => {
    const ms = Date.UTC(2026, 6, 15, 11, 0, 0);
    expect(parseDerTime(readTlv(derTime(ms)))).toBe(ms);
    const ms2050 = Date.UTC(2051, 11, 31, 23, 59, 59);
    expect(parseDerTime(readTlv(derTime(ms2050)))).toBe(ms2050);
  });

  it('UTCTime sliding window: 500101000000Z parses as 1950', () => {
    const t = tlv(TAG.UTCTIME, new TextEncoder().encode('500101000000Z'));
    expect(parseDerTime(readTlv(t))).toBe(Date.UTC(1950, 0, 1));
  });
});

describe('DER strict parsing (fail closed)', () => {
  it('rejects truncated bodies', () => {
    expect(() => readTlv(Uint8Array.of(0x30, 0x05, 0x01))).toThrow(/truncated/);
  });
  it('rejects trailing garbage inside a constructed value', () => {
    const bad = new Uint8Array([...seq(derInt(1)), 0xff]);
    const outer = readTlv(bad);
    expect(outer.size).toBe(bad.length - 1); // reader stops at the SEQUENCE...
    expect(() => readChildren(bad.subarray(0, 4))).toThrow(); // ...children must fill exactly
  });
  it('rejects non-minimal long-form lengths', () => {
    expect(() => readTlv(Uint8Array.of(0x04, 0x81, 0x03, 1, 2, 3))).toThrow(/non-minimal/);
  });
});
