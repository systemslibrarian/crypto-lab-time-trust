/**
 * Ed25519 (RFC 8032) via @noble/curves — a small, audited, pure-JS library.
 * Chosen over WebCrypto because Ed25519 in SubtleCrypto is still not available
 * in every shipping browser; the signatures and verifications here are real.
 * Validated against the RFC 8032 §7.1 test vectors.
 */
import { ed25519 } from '@noble/curves/ed25519.js';

export interface Ed25519KeyPair {
  privateKey: Uint8Array; // 32-byte seed
  publicKey: Uint8Array; // 32-byte compressed point
}

export function generateKeyPair(): Ed25519KeyPair {
  const privateKey = crypto.getRandomValues(new Uint8Array(32));
  return { privateKey, publicKey: ed25519.getPublicKey(privateKey) };
}

export function publicKeyOf(privateKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(privateKey);
}

export function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey);
}

export function verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false; // malformed signature/key: fail closed
  }
}
