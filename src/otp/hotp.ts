/**
 * HOTP (RFC 4226) — hand-rolled on top of a real HMAC, because the dynamic
 * truncation step is one of the inspectable teaching parts of this lab.
 * Validated against the RFC 4226 Appendix D test vectors.
 */
import { hmac, type HmacHash } from '../crypto/hmac';

/** 8-byte big-endian counter block (RFC 4226 §5.1). */
export function counterBytes(counter: number): Uint8Array {
  if (!Number.isInteger(counter) || counter < 0) throw new Error('counter must be a non-negative integer');
  const out = new Uint8Array(8);
  let n = counter;
  for (let i = 7; i >= 0; i--) {
    out[i] = n % 256;
    n = Math.floor(n / 256);
  }
  return out;
}

/** RFC 4226 §5.3 dynamic truncation: low nibble of the last byte picks the offset. */
export function dynamicTruncate(mac: Uint8Array): number {
  const offset = mac[mac.length - 1] & 0x0f;
  return (
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]
  );
}

export async function hotp(
  key: Uint8Array,
  counter: number,
  digits = 6,
  hash: HmacHash = 'SHA-1',
): Promise<string> {
  const mac = await hmac(hash, key, counterBytes(counter));
  const code = dynamicTruncate(mac) % 10 ** digits;
  return String(code).padStart(digits, '0');
}
