import { describe, expect, it } from 'vitest';
import { fromHex } from '../core/bytes';
import { DEMO_EPOCH_MS, HOUR } from '../time/clock';
import { createCertificate, parseCertificate, tamperSignatureBit, verifyCertSignature } from './cert';
import { validityChecks, validityState } from './validity';

// deterministic key for tests (RFC 8032 TEST 1 secret key)
const SK = fromHex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');

const PARAMS = {
  serial: 4097,
  issuerCN: 'Time Trust Demo CA',
  subjectCN: 'demo.time-trust.example',
  notBeforeMs: DEMO_EPOCH_MS - HOUR,
  notAfterMs: DEMO_EPOCH_MS + 24 * HOUR,
};

describe('minimal X.509 certificate', () => {
  it('builds, parses back, and every field round-trips', () => {
    const cert = createCertificate(PARAMS, SK);
    const parsed = parseCertificate(cert.der);
    expect(parsed.serial).toBe(PARAMS.serial);
    expect(parsed.issuerCN).toBe(PARAMS.issuerCN);
    expect(parsed.subjectCN).toBe(PARAMS.subjectCN);
    expect(parsed.notBeforeMs).toBe(PARAMS.notBeforeMs);
    expect(parsed.notAfterMs).toBe(PARAMS.notAfterMs);
    expect([...parsed.publicKey]).toEqual([...cert.publicKey]);
    expect([...parsed.signature]).toEqual([...cert.signature]);
    expect([...parsed.tbs]).toEqual([...cert.tbs]);
  });

  it('signature verifies over the parsed TBS bytes', () => {
    const parsed = parseCertificate(createCertificate(PARAMS, SK).der);
    expect(verifyCertSignature(parsed)).toBe(true);
  });

  it('a single flipped signature bit fails verification', () => {
    const cert = createCertificate(PARAMS, SK);
    const parsed = parseCertificate(tamperSignatureBit(cert.der));
    expect(verifyCertSignature(parsed)).toBe(false);
  });

  it('rejects trailing bytes after the Certificate', () => {
    const cert = createCertificate(PARAMS, SK);
    expect(() => parseCertificate(new Uint8Array([...cert.der, 0x00]))).toThrow(/trailing/);
  });

  it('the DER changes when validity dates change — dates live inside the signed TBS', () => {
    const a = createCertificate(PARAMS, SK);
    const b = createCertificate({ ...PARAMS, notAfterMs: PARAMS.notAfterMs + 1000 }, SK);
    expect([...a.tbs]).not.toEqual([...b.tbs]);
    expect([...a.signature]).not.toEqual([...b.signature]);
  });
});

describe('RFC 5280 §4.1.2.5 validity (inclusive bounds)', () => {
  const { notBeforeMs, notAfterMs } = PARAMS;
  it('before notBefore → not-yet-valid', () => {
    expect(validityState(notBeforeMs, notAfterMs, notBeforeMs - 1)).toBe('not-yet-valid');
  });
  it('exactly notBefore → valid (inclusive)', () => {
    expect(validityState(notBeforeMs, notAfterMs, notBeforeMs)).toBe('valid');
  });
  it('exactly notAfter → valid (inclusive)', () => {
    expect(validityState(notBeforeMs, notAfterMs, notAfterMs)).toBe('valid');
  });
  it('after notAfter → expired', () => {
    expect(validityState(notBeforeMs, notAfterMs, notAfterMs + 1)).toBe('expired');
  });
  it('policy checks report the failing comparison', () => {
    const checks = validityChecks(notBeforeMs, notAfterMs, notAfterMs + 1000);
    expect(checks[0].pass).toBe(true);
    expect(checks[1].pass).toBe(false);
  });
});
