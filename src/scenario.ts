/**
 * The one shared scenario every panel verifies against. All key material is
 * generated fresh per page load and lives only in memory; all timestamps are
 * anchored to the fixed demo epoch so the timeline is reproducible.
 */
import { generateKeyPair, type Ed25519KeyPair } from './crypto/ed25519';
import { signJwt, type JwtClaims } from './jwt/jwt';
import { makeRequest, type AuthRequest } from './replay/replay';
import { DEMO_EPOCH_MS, HOUR, MIN } from './time/clock';
import { signToken, type NodeToken } from './token/token';
import { createCertificate, type Certificate } from './x509/cert';
import { createSignedUrl, type SignedUrl } from './url/signedurl';

export const EPOCH_SEC = Math.floor(DEMO_EPOCH_MS / 1000);

export const CERT_NOT_BEFORE_MS = DEMO_EPOCH_MS - 1 * HOUR;
export const CERT_NOT_AFTER_MS = DEMO_EPOCH_MS + 24 * HOUR;
export const JWT_EXP_SEC = EPOCH_SEC + 15 * 60;
export const URL_EXPIRES_SEC = EPOCH_SEC + 20 * 60;
export const TOKEN_EXP_SEC = EPOCH_SEC + 30 * 60;

export interface Scenario {
  certKeys: Ed25519KeyPair;
  cert: Certificate;
  jwtKey: Uint8Array;
  jwtClaims: JwtClaims;
  jwtToken: string;
  totpSecret: Uint8Array;
  urlSecret: Uint8Array;
  signedUrl: SignedUrl;
  replaySecret: Uint8Array;
  initialRequest: AuthRequest;
  tokenKeys: Ed25519KeyPair;
  nodeToken: NodeToken;
}

export async function buildScenario(): Promise<Scenario> {
  const certKeys = generateKeyPair();
  const cert = createCertificate(
    {
      serial: 4097,
      issuerCN: 'Time Trust Demo CA',
      subjectCN: 'demo.time-trust.example',
      notBeforeMs: CERT_NOT_BEFORE_MS,
      notAfterMs: CERT_NOT_AFTER_MS,
    },
    certKeys.privateKey,
  );

  const jwtKey = crypto.getRandomValues(new Uint8Array(32));
  const jwtClaims: JwtClaims = { sub: 'alice', iat: EPOCH_SEC, nbf: EPOCH_SEC, exp: JWT_EXP_SEC };
  const jwtToken = await signJwt(jwtClaims, jwtKey);

  const totpSecret = crypto.getRandomValues(new Uint8Array(20));

  const urlSecret = crypto.getRandomValues(new Uint8Array(32));
  const signedUrl = await createSignedUrl(urlSecret, 'GET', '/files/quarterly-report.pdf', URL_EXPIRES_SEC);

  const replaySecret = crypto.getRandomValues(new Uint8Array(32));
  const initialRequest = await makeRequest(replaySecret, 'POST /transfer amount=100 to=mallory', EPOCH_SEC);

  const tokenKeys = generateKeyPair();
  const nodeToken = signToken(tokenKeys.privateKey, 'service-alpha', TOKEN_EXP_SEC);

  return {
    certKeys,
    cert,
    jwtKey,
    jwtClaims,
    jwtToken,
    totpSecret,
    urlSecret,
    signedUrl,
    replaySecret,
    initialRequest,
    tokenKeys,
    nodeToken,
  };
}

export { MIN };
