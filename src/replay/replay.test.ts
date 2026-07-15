import { describe, expect, it } from 'vitest';
import { utf8 } from '../core/bytes';
import { makeRequest, serverCheck } from './replay';

const SECRET = utf8('replay-test-secret');
const T = 3_000_000_000; // the moment the request is really sent

describe('freshness window + per-server replay cache (RFC 4120 §3.1.3 style)', () => {
  it('same request, three skewed servers, three different outcomes', async () => {
    const req = await makeRequest(SECRET, 'transfer $100', T);
    // 6 minutes after sending: an honest clock calls it stale.
    const now = T + 360;
    const slow = await serverCheck(SECRET, req, now - 240, new Set()); // clock 4 min behind
    const honest = await serverCheck(SECRET, req, now, new Set());
    const fast = await serverCheck(SECRET, req, now + 240, new Set()); // 4 min ahead
    expect(slow.verdict).toBe('accept'); // sees age 120 s — "fresh"
    expect(honest.verdict).toBe('reject'); // age 360 s > 300 s
    expect(fast.verdict).toBe('reject'); // age 600 s
    for (const r of [slow, honest, fast]) expect(r.crypto[0].ok).toBe(true); // MAC valid everywhere
  });

  it('freshness is two-sided: a timestamp too far in the FUTURE also rejects', async () => {
    const req = await makeRequest(SECRET, 'x', T + 600);
    const r = await serverCheck(SECRET, req, T, new Set());
    expect(r.verdict).toBe('reject');
    expect(r.ageSec).toBe(-600);
  });

  it('a server that accepted once detects the replay via its cache', async () => {
    const cache = new Set<string>();
    const req = await makeRequest(SECRET, 'x', T);
    expect((await serverCheck(SECRET, req, T + 10, cache)).verdict).toBe('accept');
    const replay = await serverCheck(SECRET, req, T + 60, cache);
    expect(replay.verdict).toBe('reject');
    expect(replay.replayDetected).toBe(true);
  });

  it('the replay slips through a DIFFERENT server whose slow clock still calls it fresh', async () => {
    const cacheB = new Set<string>();
    const cacheA = new Set<string>();
    const req = await makeRequest(SECRET, 'x', T);
    await serverCheck(SECRET, req, T + 10, cacheB); // original goes to B
    // 6 min later the attacker replays to A, whose clock runs 4 min behind:
    const replayed = await serverCheck(SECRET, req, T + 360 - 240, cacheA);
    expect(replayed.verdict).toBe('accept'); // the failure the panel demonstrates
    expect(replayed.crypto[0].ok).toBe(true);
  });

  it('rejects a tampered body outright — replay ≠ forgery', async () => {
    const req = await makeRequest(SECRET, 'transfer $100', T);
    const forged = { ...req, body: 'transfer $9999' };
    const r = await serverCheck(SECRET, forged, T + 10, new Set());
    expect(r.crypto[0].ok).toBe(false);
    expect(r.verdict).toBe('reject');
  });
});
