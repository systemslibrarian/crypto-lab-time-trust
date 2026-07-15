import { describe, expect, it } from 'vitest';
import { utf8 } from '../core/bytes';
import { createSignedUrl, verifySignedUrl } from './signedurl';

const SECRET = utf8('signed-url-test-secret');
const EXP = 2_000_000_000;

describe('signed URL (HMAC + server-clock expiry)', () => {
  it('accepts a fresh URL with a valid MAC', async () => {
    const url = await createSignedUrl(SECRET, 'GET', '/files/report.pdf', EXP);
    const r = await verifySignedUrl(SECRET, url, EXP - 100);
    expect(r.crypto[0].ok).toBe(true);
    expect(r.verdict).toBe('accept');
  });

  it('expiry is inclusive at the boundary, rejects one second past', async () => {
    const url = await createSignedUrl(SECRET, 'GET', '/files/report.pdf', EXP);
    expect((await verifySignedUrl(SECRET, url, EXP)).verdict).toBe('accept');
    const late = await verifySignedUrl(SECRET, url, EXP + 1);
    expect(late.verdict).toBe('reject');
    expect(late.crypto[0].ok).toBe(true); // the MAC never stopped being valid
  });

  it('tampering with expires breaks the MAC (dates are authenticated…)', async () => {
    const url = await createSignedUrl(SECRET, 'GET', '/files/report.pdf', EXP);
    const forged = { ...url, expiresSec: EXP + 3600 };
    const r = await verifySignedUrl(SECRET, forged, EXP + 100);
    expect(r.crypto[0].ok).toBe(false);
    expect(r.verdict).toBe('reject');
  });

  it('…but rolling the SERVER clock back resurrects an expired URL with no forgery at all', async () => {
    const url = await createSignedUrl(SECRET, 'GET', '/files/report.pdf', EXP);
    const honest = await verifySignedUrl(SECRET, url, EXP + 600);
    expect(honest.verdict).toBe('reject');
    const rolledBack = await verifySignedUrl(SECRET, url, EXP - 600); // attacker moved the server clock
    expect(rolledBack.verdict).toBe('accept'); // the failure the panel demonstrates
    expect(rolledBack.crypto[0].ok).toBe(true);
  });

  it('rejects a corrupted signature', async () => {
    const url = await createSignedUrl(SECRET, 'GET', '/files/report.pdf', EXP);
    const bad = { ...url, sig: url.sig.slice(0, -2) + (url.sig.endsWith('A') ? 'BB' : 'AA') };
    expect((await verifySignedUrl(SECRET, bad, EXP - 100)).verdict).toBe('reject');
  });
});
