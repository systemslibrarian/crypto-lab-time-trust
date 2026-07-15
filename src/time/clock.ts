/**
 * The lab's model of time. One master clock ("true time", learner-controlled)
 * plus per-party skews. Every verifier in the lab takes a clock VALUE as an
 * argument — no module ever reads Date.now() — which is the design invariant
 * this demo exists to make visible: time is an input, and inputs can lie.
 */

/** Fixed demo epoch: 2026-07-15T12:00:00Z. All scenario artifacts anchor here. */
export const DEMO_EPOCH_MS = Date.UTC(2026, 6, 15, 12, 0, 0);

export const SEC = 1000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** Master slider range relative to the demo epoch. */
export const CLOCK_MIN_OFFSET_MS = -2 * HOUR;
export const CLOCK_MAX_OFFSET_MS = 48 * HOUR;

export function fmtUtc(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`
  );
}

/** Signed human offset from the demo epoch, e.g. "T+15m 30s" / "T−1h 05m". */
export function fmtOffset(ms: number): string {
  const rel = ms - DEMO_EPOCH_MS;
  if (rel === 0) return 'T+0s';
  const sign = rel < 0 ? '−' : '+';
  let s = Math.abs(Math.round(rel / SEC));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return `T${sign}${parts.slice(0, 2).join(' ')}`;
}

/** Compact signed skew, e.g. "+90 s" / "−4 min" / "0 s". */
export function fmtSkew(skewSec: number): string {
  if (skewSec === 0) return '0 s';
  const sign = skewSec < 0 ? '−' : '+';
  const a = Math.abs(skewSec);
  if (a % 60 === 0) return `${sign}${a / 60} min`;
  return `${sign}${a} s`;
}
