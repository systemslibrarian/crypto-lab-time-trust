/**
 * HMAC (RFC 2104) via WebCrypto SubtleCrypto — real keyed hashing, nothing
 * simulated. HMAC internals are not this lab's teaching subject (the
 * time-dependent verifiers built on top of it are), so the platform
 * implementation is used and validated against the RFC 4231 test vectors.
 */

export type HmacHash = 'SHA-1' | 'SHA-256' | 'SHA-512';

export async function hmac(hash: HmacHash, key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    'raw',
    key.slice().buffer as ArrayBuffer,
    { name: 'HMAC', hash },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, msg.slice().buffer as ArrayBuffer);
  return new Uint8Array(sig);
}
