import { describe, expect, it } from 'vitest';
import { fromHex } from '../core/bytes';
import { publicKeyOf } from '../crypto/ed25519';
import { signToken, verifyToken } from './token';

const SK = fromHex('4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb');
const PK = publicKeyOf(SK);
const EXP = 4_000_000_000;

describe('distributed Ed25519 token', () => {
  it('one token, three node clocks, divergent verdicts, identical valid signature', () => {
    const tok = signToken(SK, 'service-A', EXP);
    const atSlow = verifyToken(PK, tok.encoded, EXP - 120);
    const atHonest = verifyToken(PK, tok.encoded, EXP + 1);
    const atFast = verifyToken(PK, tok.encoded, EXP + 120);
    expect(atSlow.verdict).toBe('accept');
    expect(atHonest.verdict).toBe('reject');
    expect(atFast.verdict).toBe('reject');
    for (const r of [atSlow, atHonest, atFast]) expect(r.crypto[0].ok).toBe(true);
  });

  it('rejects a wrong public key', () => {
    const tok = signToken(SK, 'service-A', EXP);
    const otherPk = publicKeyOf(fromHex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'));
    const r = verifyToken(otherPk, tok.encoded, EXP - 120);
    expect(r.crypto[0].ok).toBe(false);
    expect(r.verdict).toBe('reject');
  });

  it('fails closed on malformed tokens', () => {
    expect(verifyToken(PK, 'garbage', 0).verdict).toBe('reject');
    expect(verifyToken(PK, 'a.b', 0).verdict).toBe('reject');
  });
});
