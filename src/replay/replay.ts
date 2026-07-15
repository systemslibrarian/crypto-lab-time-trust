/**
 * Kerberos-style freshness + replay protection (RFC 4120 §3.1.3): a request
 * carries the CLIENT's timestamp under a real MAC; each server accepts it only
 * if |server_now − timestamp| ≤ skew window (default 5 minutes) and the exact
 * authenticator has not been seen before. The replay cache is per-server and
 * only needs to span the skew window — everything older is stale anyway.
 */
import { b64urlDecode, b64urlEncode, timingSafeEqual, utf8 } from '../core/bytes';
import { decide, type Decision } from '../core/decision';
import { hmac } from '../crypto/hmac';
import { fmtUtc } from '../time/clock';

export const DEFAULT_SKEW_WINDOW_SEC = 300;

export interface AuthRequest {
  body: string;
  /** client's claim of when it sent this — inside the MAC, so it can't be edited, only replayed */
  timestampSec: number;
  mac: string; // base64url
}

export async function makeRequest(
  secret: Uint8Array,
  body: string,
  clientNowSec: number,
): Promise<AuthRequest> {
  const mac = await hmac('SHA-256', secret, utf8(`${clientNowSec}\n${body}`));
  return { body, timestampSec: clientNowSec, mac: b64urlEncode(mac) };
}

export interface ServerCheck extends Decision {
  ageSec: number;
  replayDetected: boolean;
}

/** One server's decision about one request, at that server's clock. */
export async function serverCheck(
  secret: Uint8Array,
  req: AuthRequest,
  serverNowSec: number,
  replayCache: Set<string>,
  skewWindowSec = DEFAULT_SKEW_WINDOW_SEC,
): Promise<ServerCheck> {
  let macOk = false;
  try {
    const expected = await hmac('SHA-256', secret, utf8(`${req.timestampSec}\n${req.body}`));
    macOk = timingSafeEqual(expected, b64urlDecode(req.mac));
  } catch {
    macOk = false;
  }
  const ageSec = serverNowSec - req.timestampSec;
  const fresh = Math.abs(ageSec) <= skewWindowSec;
  const replayDetected = macOk && fresh && replayCache.has(req.mac);
  const decision = decide(
    [
      {
        ok: macOk,
        label: 'HMAC-SHA-256 over timestamp + body',
        detail: `mac=${req.mac.slice(0, 16)}… ${macOk ? 'matches' : 'does NOT match'}`,
      },
    ],
    [
      {
        name: `freshness |age| ≤ ${skewWindowSec} s (RFC 4120 §3.1.3)`,
        pass: fresh,
        detail: `server clock ${fmtUtc(serverNowSec * 1000)} − timestamp ${fmtUtc(req.timestampSec * 1000)} = ${ageSec} s`,
      },
      {
        name: 'not in replay cache',
        pass: !replayDetected,
        detail: replayDetected
          ? 'this exact authenticator was already accepted by THIS server'
          : 'authenticator not seen before by this server',
      },
    ],
  );
  if (decision.verdict === 'accept') replayCache.add(req.mac);
  return { ...decision, ageSec, replayDetected };
}
