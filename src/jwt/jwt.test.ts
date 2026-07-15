/**
 * JWS/JWT: the RFC 7515 Appendix A.1 HS256 known-answer test (1 KAT) plus the
 * time-claim behavior — including the split-brain property the panel shows:
 * one token, two verifiers, two verdicts, purely from clock skew.
 */
import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode, utf8 } from '../core/bytes';
import { hmac } from '../crypto/hmac';
import { signJwt, verifyJwt, type JwtClaims } from './jwt';

describe('JWS HS256 KAT (RFC 7515 Appendix A.1)', () => {
  it('reproduces the spec signature over the spec signing input', async () => {
    const key = b64urlDecode(
      'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow',
    );
    const signingInput =
      'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.' +
      'eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ';
    const mac = await hmac('SHA-256', key, utf8(signingInput));
    expect(b64urlEncode(mac)).toBe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  });
});

const KEY = utf8('a-per-session-secret-for-tests-only');
const CLAIMS: JwtClaims = { sub: 'alice', iat: 1_000_000, nbf: 1_000_000, exp: 1_000_900 };

describe('JWT time claims (RFC 7519 §4.1)', () => {
  it('round-trips: valid signature and fresh claims accept', async () => {
    const token = await signJwt(CLAIMS, KEY);
    const r = await verifyJwt(token, KEY, 1_000_450);
    expect(r.crypto[0].ok).toBe(true);
    expect(r.verdict).toBe('accept');
  });

  it('exp is strict: now === exp rejects (current time MUST be BEFORE exp)', async () => {
    const token = await signJwt(CLAIMS, KEY);
    const r = await verifyJwt(token, KEY, CLAIMS.exp);
    expect(r.verdict).toBe('reject');
    expect(r.crypto[0].ok).toBe(true); // signature still perfectly valid
  });

  it('nbf is inclusive: now === nbf accepts', async () => {
    const token = await signJwt(CLAIMS, KEY);
    expect((await verifyJwt(token, KEY, CLAIMS.nbf)).verdict).toBe('accept');
  });

  it('before nbf rejects with a valid signature', async () => {
    const token = await signJwt(CLAIMS, KEY);
    const r = await verifyJwt(token, KEY, CLAIMS.nbf - 1);
    expect(r.verdict).toBe('reject');
    expect(r.crypto[0].ok).toBe(true);
  });

  it('leeway resurrects an exp/nbf failure by exactly the leeway amount', async () => {
    const token = await signJwt(CLAIMS, KEY);
    expect((await verifyJwt(token, KEY, CLAIMS.exp + 59, 60)).verdict).toBe('accept');
    expect((await verifyJwt(token, KEY, CLAIMS.exp + 60, 60)).verdict).toBe('reject');
    expect((await verifyJwt(token, KEY, CLAIMS.nbf - 60, 60)).verdict).toBe('accept');
  });

  it('split-brain: one token, verifiers 90 s apart, opposite verdicts', async () => {
    const token = await signJwt(CLAIMS, KEY);
    const trueNow = CLAIMS.exp - 45;
    const authServer = await verifyJwt(token, KEY, trueNow); // clock correct
    const resourceServer = await verifyJwt(token, KEY, trueNow + 90); // clock 90 s fast
    expect(authServer.verdict).toBe('accept');
    expect(resourceServer.verdict).toBe('reject');
    // identical bytes, identical (valid) signature on both sides:
    expect(authServer.crypto[0].ok).toBe(true);
    expect(resourceServer.crypto[0].ok).toBe(true);
  });

  it('a tampered payload fails the SIGNATURE check, not the time check', async () => {
    const token = await signJwt(CLAIMS, KEY);
    const [h, p, s] = token.split('.');
    const claims = { ...CLAIMS, exp: CLAIMS.exp + 9999 };
    const forgedPayload = b64urlEncode(utf8(JSON.stringify(claims)));
    const r = await verifyJwt(`${h}.${forgedPayload}.${s}`, KEY, 1_000_450);
    expect(r.crypto[0].ok).toBe(false);
    expect(r.verdict).toBe('reject');
    expect(p).not.toBe(forgedPayload);
  });

  it('fails closed on malformed tokens', async () => {
    expect((await verifyJwt('not-a-jwt', KEY, 0)).verdict).toBe('reject');
    expect((await verifyJwt('a.b', KEY, 0)).verdict).toBe('reject');
    expect((await verifyJwt('a.b.c.d', KEY, 0)).verdict).toBe('reject');
  });
});
