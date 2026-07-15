/**
 * JWT with HS256 (RFC 7519 / JWS RFC 7515): real HMAC-SHA-256 over the exact
 * signing input `BASE64URL(header) || '.' || BASE64URL(payload)`.
 *
 * The time checks implement RFC 7519 §4.1.4 (exp: "the current date/time MUST
 * be before the expiration time", with optional small leeway) and §4.1.5
 * (nbf: MUST NOT be accepted before, with optional leeway). iat (§4.1.6) is
 * informational — it records when the token was issued and is displayed, but
 * RFC 7519 attaches no acceptance rule to it, so none is enforced here.
 */
import { b64urlDecode, b64urlEncode, timingSafeEqual, utf8 } from '../core/bytes';
import { decide, type Decision } from '../core/decision';
import { hmac } from '../crypto/hmac';
import { fmtUtc } from '../time/clock';

export interface JwtClaims {
  sub: string;
  iat: number; // NumericDate, seconds
  nbf: number;
  exp: number;
}

export async function signJwt(claims: JwtClaims, key: Uint8Array): Promise<string> {
  const header = b64urlEncode(utf8(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64urlEncode(utf8(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  const mac = await hmac('SHA-256', key, utf8(signingInput));
  return `${signingInput}.${b64urlEncode(mac)}`;
}

export interface JwtVerification extends Decision {
  claims: JwtClaims | null;
}

/**
 * Verify signature + time claims as one verifier at one clock. `nowSec` is a
 * NumericDate at the VERIFIER's clock — two verifiers with skewed clocks give
 * different answers about the same bytes.
 */
export async function verifyJwt(
  token: string,
  key: Uint8Array,
  nowSec: number,
  leewaySec = 0,
): Promise<JwtVerification> {
  let claims: JwtClaims | null = null;
  let sigOk = false;
  let sigDetail = 'malformed token';
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('JWT must have three parts');
    const expected = await hmac('SHA-256', key, utf8(`${parts[0]}.${parts[1]}`));
    sigOk = timingSafeEqual(expected, b64urlDecode(parts[2]));
    sigDetail = `HMAC-SHA-256 over ${parts[0].slice(0, 8)}…​.${parts[1].slice(0, 8)}… ${sigOk ? 'matches' : 'does NOT match'} tag ${parts[2].slice(0, 12)}…`;
    const decoded: unknown = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    const c = decoded as Record<string, unknown>;
    if (
      typeof c.sub !== 'string' ||
      typeof c.iat !== 'number' ||
      typeof c.nbf !== 'number' ||
      typeof c.exp !== 'number'
    ) {
      throw new Error('missing required claims');
    }
    claims = c as unknown as JwtClaims;
  } catch {
    claims = null;
  }
  const crypto = [{ ok: sigOk, label: 'HMAC-SHA-256 signature (HS256)', detail: sigDetail }];
  if (!claims) {
    return { ...decide(crypto, [{ name: 'parse claims', pass: false, detail: 'unparseable payload' }]), claims };
  }
  const expPass = nowSec < claims.exp + leewaySec;
  const nbfPass = nowSec >= claims.nbf - leewaySec;
  const policy = [
    {
      name: 'exp (RFC 7519 §4.1.4)',
      pass: expPass,
      detail: `clock ${fmtUtc(nowSec * 1000)} ${expPass ? '<' : '≥'} exp ${fmtUtc(claims.exp * 1000)}${leewaySec ? ` + ${leewaySec}s leeway` : ''}`,
    },
    {
      name: 'nbf (RFC 7519 §4.1.5)',
      pass: nbfPass,
      detail: `clock ${fmtUtc(nowSec * 1000)} ${nbfPass ? '≥' : '<'} nbf ${fmtUtc(claims.nbf * 1000)}${leewaySec ? ` − ${leewaySec}s leeway` : ''}`,
    },
  ];
  return { ...decide(crypto, policy), claims };
}
