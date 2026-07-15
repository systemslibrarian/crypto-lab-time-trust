/**
 * A minimal Ed25519-signed bearer token for the distributed-nodes panel:
 * payload JSON `{sub, exp}` really signed, really verified by each node —
 * against that node's own clock. One token, one signature, N verdicts.
 */
import { b64urlDecode, b64urlEncode, utf8 } from '../core/bytes';
import { decide, type Decision } from '../core/decision';
import * as ed from '../crypto/ed25519';
import { fmtUtc } from '../time/clock';

export interface NodeToken {
  payload: { sub: string; exp: number };
  encoded: string; // base64url(payload).base64url(sig)
}

export function signToken(privateKey: Uint8Array, sub: string, expSec: number): NodeToken {
  const payload = { sub, exp: expSec };
  const body = utf8(JSON.stringify(payload));
  const sig = ed.sign(body, privateKey);
  return { payload, encoded: `${b64urlEncode(body)}.${b64urlEncode(sig)}` };
}

export function verifyToken(publicKey: Uint8Array, encoded: string, nodeNowSec: number): Decision {
  let sigOk = false;
  let exp = 0;
  let parsed = false;
  try {
    const [p, s] = encoded.split('.');
    const body = b64urlDecode(p);
    sigOk = ed.verify(b64urlDecode(s), body, publicKey);
    const claims = JSON.parse(new TextDecoder().decode(body)) as { exp?: unknown };
    if (typeof claims.exp !== 'number') throw new Error('missing exp');
    exp = claims.exp;
    parsed = true;
  } catch {
    parsed = false;
  }
  const fresh = parsed && nodeNowSec < exp;
  return decide(
    [
      {
        ok: sigOk,
        label: 'Ed25519 signature over payload',
        detail: sigOk ? 'signature verifies against the shared public key' : 'signature INVALID',
      },
    ],
    [
      {
        name: 'exp (node clock)',
        pass: fresh,
        detail: parsed
          ? `node clock ${fmtUtc(nodeNowSec * 1000)} ${fresh ? '<' : '≥'} exp ${fmtUtc(exp * 1000)}`
          : 'unparseable payload',
      },
    ],
  );
}
