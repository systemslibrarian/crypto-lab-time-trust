/**
 * HOTP/TOTP spec KATs and acceptance-window behavior.
 *  - HOTP: RFC 4226 Appendix D, counters 0–9        (10 KATs)
 *  - TOTP: RFC 6238 Appendix B, 6 times × 3 hashes  (18 KATs)
 */
import { describe, expect, it } from 'vitest';
import { utf8 } from '../core/bytes';
import type { HmacHash } from '../crypto/hmac';
import { counterBytes, hotp } from './hotp';
import { totp, totpCounter, verifyTotp } from './totp';

const HOTP_SECRET = utf8('12345678901234567890');

describe('HOTP KATs (RFC 4226 Appendix D)', () => {
  const expected = [
    '755224', '287082', '359152', '969429', '338314',
    '254676', '287922', '162583', '399871', '520489',
  ];
  expected.forEach((code, counter) => {
    it(`counter=${counter} → ${code}`, async () => {
      expect(await hotp(HOTP_SECRET, counter)).toBe(code);
    });
  });
});

// RFC 6238 Appendix B: the seed is the algorithm's hash-length ASCII string.
const SEED: Record<HmacHash, Uint8Array> = {
  'SHA-1': utf8('12345678901234567890'),
  'SHA-256': utf8('12345678901234567890123456789012'),
  'SHA-512': utf8('1234567890123456789012345678901234567890123456789012345678901234'),
};

const TOTP_VECTORS: Array<{ t: number; hash: HmacHash; code: string }> = [
  { t: 59, hash: 'SHA-1', code: '94287082' },
  { t: 59, hash: 'SHA-256', code: '46119246' },
  { t: 59, hash: 'SHA-512', code: '90693936' },
  { t: 1111111109, hash: 'SHA-1', code: '07081804' },
  { t: 1111111109, hash: 'SHA-256', code: '68084774' },
  { t: 1111111109, hash: 'SHA-512', code: '25091201' },
  { t: 1111111111, hash: 'SHA-1', code: '14050471' },
  { t: 1111111111, hash: 'SHA-256', code: '67062674' },
  { t: 1111111111, hash: 'SHA-512', code: '99943326' },
  { t: 1234567890, hash: 'SHA-1', code: '89005924' },
  { t: 1234567890, hash: 'SHA-256', code: '91819424' },
  { t: 1234567890, hash: 'SHA-512', code: '93441116' },
  { t: 2000000000, hash: 'SHA-1', code: '69279037' },
  { t: 2000000000, hash: 'SHA-256', code: '90698825' },
  { t: 2000000000, hash: 'SHA-512', code: '38618901' },
  { t: 20000000000, hash: 'SHA-1', code: '65353130' },
  { t: 20000000000, hash: 'SHA-256', code: '77737706' },
  { t: 20000000000, hash: 'SHA-512', code: '47863826' },
];

describe('TOTP KATs (RFC 6238 Appendix B)', () => {
  for (const v of TOTP_VECTORS) {
    it(`t=${v.t} ${v.hash} → ${v.code}`, async () => {
      expect(await totp(SEED[v.hash], v.t, { digits: 8, hash: v.hash })).toBe(v.code);
    });
  }
});

describe('counter encoding', () => {
  it('encodes big-endian 8 bytes', () => {
    expect([...counterBytes(1)]).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect([...counterBytes(0x1234)]).toEqual([0, 0, 0, 0, 0, 0, 0x12, 0x34]);
  });
  it('rejects negative counters', () => {
    expect(() => counterBytes(-1)).toThrow();
  });
});

describe('TOTP acceptance window (policy, not crypto)', () => {
  const key = SEED['SHA-1'];
  const now = 1_700_000_015; // mid-window

  it('accepts the current-window code at tolerance 0', async () => {
    const code = await totp(key, now);
    const r = await verifyTotp(key, code, now, 0, null);
    expect(r.accepted).toBe(true);
    expect(r.windows).toHaveLength(1);
  });

  it('rejects the previous-window code at tolerance 0', async () => {
    const prev = await totp(key, now - 30);
    const r = await verifyTotp(key, prev, now, 0, null);
    expect(r.accepted).toBe(false);
  });

  it('accepts the previous-window code at tolerance ±1 (the widened policy)', async () => {
    const prev = await totp(key, now - 30);
    const r = await verifyTotp(key, prev, now, 1, null);
    expect(r.accepted).toBe(true);
    expect(r.windows).toHaveLength(3); // band = 2W+1 windows
    expect(r.matchedCounter).toBe(totpCounter(now) - 1);
  });

  it('tolerance ±2 widens the band to 5 windows', async () => {
    const r = await verifyTotp(key, '000000', now, 2, null);
    expect(r.windows).toHaveLength(5);
  });

  it('one-time-use record blocks a replayed code (RFC 6238 §5.2)', async () => {
    const used = new Set<string>();
    const code = await totp(key, now);
    const first = await verifyTotp(key, code, now, 1, used);
    expect(first.accepted).toBe(true);
    const replay = await verifyTotp(key, code, now + 10, 1, used);
    expect(replay.accepted).toBe(false);
    expect(replay.replayDetected).toBe(true);
  });

  it('WITHOUT the record, the same code replays successfully inside the band', async () => {
    const code = await totp(key, now);
    const replay = await verifyTotp(key, code, now + 30, 1, null); // next window, ±1 tolerance
    expect(replay.accepted).toBe(true); // the flaw the panel demonstrates
  });
});
