/**
 * TOTP (RFC 6238) = HOTP over a time-derived counter T = ⌊(now − T0) / step⌋.
 * The verifier's acceptance window is POLICY, not cryptography: RFC 6238 §5.2
 * recommends accepting at most one time step backward to absorb transmission
 * delay, and REQUIRES that a code that has already been used be rejected
 * (one-time use). Validated against the RFC 6238 Appendix B test vectors.
 */
import { timingSafeEqual, utf8 } from '../core/bytes';
import type { HmacHash } from '../crypto/hmac';
import { hotp } from './hotp';

export const TOTP_STEP_SEC = 30;

export function totpCounter(nowSec: number, stepSec = TOTP_STEP_SEC, t0Sec = 0): number {
  return Math.floor((nowSec - t0Sec) / stepSec);
}

export async function totp(
  key: Uint8Array,
  nowSec: number,
  opts: { stepSec?: number; digits?: number; hash?: HmacHash } = {},
): Promise<string> {
  return hotp(key, totpCounter(nowSec, opts.stepSec ?? TOTP_STEP_SEC), opts.digits ?? 6, opts.hash ?? 'SHA-1');
}

export interface TotpWindowResult {
  counter: number;
  code: string;
  match: boolean;
}

export interface TotpVerification {
  /** every window the policy checked, in counter order */
  windows: TotpWindowResult[];
  /** counter of the matching window, or null */
  matchedCounter: number | null;
  accepted: boolean;
  /** true when the code matched but had been used before (one-time-use rule) */
  replayDetected: boolean;
}

/**
 * Verify a submitted code at the verifier's clock, checking counters
 * T−tolerance … T+tolerance. `usedCodes` (counter:code strings) models the
 * RFC 6238 §5.2 one-time-use record; pass null to model a sloppy verifier
 * that skips it.
 */
export async function verifyTotp(
  key: Uint8Array,
  submitted: string,
  verifierNowSec: number,
  tolerance: number,
  usedCodes: Set<string> | null,
  opts: { stepSec?: number; digits?: number; hash?: HmacHash } = {},
): Promise<TotpVerification> {
  const t = totpCounter(verifierNowSec, opts.stepSec ?? TOTP_STEP_SEC);
  const windows: TotpWindowResult[] = [];
  let matchedCounter: number | null = null;
  for (let c = t - tolerance; c <= t + tolerance; c++) {
    if (c < 0) continue;
    const code = await hotp(key, c, opts.digits ?? 6, opts.hash ?? 'SHA-1');
    const match = timingSafeEqual(utf8(code), utf8(submitted));
    windows.push({ counter: c, code, match });
    if (match && matchedCounter === null) matchedCounter = c;
  }
  let replayDetected = false;
  let accepted = matchedCounter !== null;
  if (accepted && usedCodes) {
    const rec = `${matchedCounter}:${submitted}`;
    if (usedCodes.has(rec)) {
      replayDetected = true;
      accepted = false;
    } else {
      usedCodes.add(rec);
    }
  }
  return { windows, matchedCounter, accepted, replayDetected };
}
