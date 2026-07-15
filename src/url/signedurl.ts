/**
 * Signed URL with expiry — the pattern used by S3 presigned URLs and CDN
 * token auth, reduced to its skeleton: HMAC-SHA-256 over
 * `METHOD \n PATH \n expires=<unixSeconds>`, expiry checked against the
 * SERVER's clock. The verifier function does not even take a client clock —
 * that absence IS the lesson of the panel that uses it.
 */
import { b64urlDecode, b64urlEncode, timingSafeEqual, utf8 } from '../core/bytes';
import { decide, type Decision } from '../core/decision';
import { hmac } from '../crypto/hmac';
import { fmtUtc } from '../time/clock';

export interface SignedUrl {
  method: string;
  path: string;
  expiresSec: number;
  sig: string; // base64url MAC
  full: string;
}

function canonical(method: string, path: string, expiresSec: number): Uint8Array {
  return utf8(`${method}\n${path}\nexpires=${expiresSec}`);
}

export async function createSignedUrl(
  secret: Uint8Array,
  method: string,
  path: string,
  expiresSec: number,
): Promise<SignedUrl> {
  const mac = await hmac('SHA-256', secret, canonical(method, path, expiresSec));
  const sig = b64urlEncode(mac);
  return { method, path, expiresSec, sig, full: `${path}?expires=${expiresSec}&sig=${sig}` };
}

/** The server's verifier. Note the signature: server clock only. */
export async function verifySignedUrl(
  secret: Uint8Array,
  url: SignedUrl,
  serverNowSec: number,
): Promise<Decision> {
  let macOk = false;
  try {
    const expected = await hmac('SHA-256', secret, canonical(url.method, url.path, url.expiresSec));
    macOk = timingSafeEqual(expected, b64urlDecode(url.sig));
  } catch {
    macOk = false;
  }
  const fresh = serverNowSec <= url.expiresSec;
  return decide(
    [
      {
        ok: macOk,
        label: 'HMAC-SHA-256 over method + path + expires',
        detail: `sig=${url.sig.slice(0, 16)}… ${macOk ? 'matches' : 'does NOT match'} recomputed MAC`,
      },
    ],
    [
      {
        name: 'not expired (server clock)',
        pass: fresh,
        detail: `server clock ${fmtUtc(serverNowSec * 1000)} ${fresh ? '≤' : '>'} expires ${fmtUtc(url.expiresSec * 1000)}`,
      },
    ],
  );
}
