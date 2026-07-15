/**
 * RFC 5280 §4.1.2.5: "The validity period for a certificate is the period of
 * time from notBefore through notAfter, inclusive." The check is two integer
 * comparisons against a clock value the caller supplies — nothing here is
 * cryptographic, which is the whole point.
 */
import type { PolicyCheck } from '../core/decision';
import { fmtUtc } from '../time/clock';

export type ValidityState = 'not-yet-valid' | 'valid' | 'expired';

export function validityState(notBeforeMs: number, notAfterMs: number, nowMs: number): ValidityState {
  if (nowMs < notBeforeMs) return 'not-yet-valid';
  if (nowMs > notAfterMs) return 'expired';
  return 'valid';
}

export function validityChecks(notBeforeMs: number, notAfterMs: number, nowMs: number): PolicyCheck[] {
  return [
    {
      name: 'notBefore ≤ clock',
      pass: notBeforeMs <= nowMs,
      detail: `notBefore ${fmtUtc(notBeforeMs)} ${notBeforeMs <= nowMs ? '≤' : '>'} clock ${fmtUtc(nowMs)}`,
    },
    {
      name: 'clock ≤ notAfter',
      pass: nowMs <= notAfterMs,
      detail: `clock ${fmtUtc(nowMs)} ${nowMs <= notAfterMs ? '≤' : '>'} notAfter ${fmtUtc(notAfterMs)}`,
    },
  ];
}
