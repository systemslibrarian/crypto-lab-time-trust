/**
 * A minimal, real X.509 v3 certificate: hand-encoded DER, really signed with
 * Ed25519 (RFC 8410, OID 1.3.101.112), really parsed back and verified.
 *
 * Deliberately minimal profile — one CN, no extensions — because this lab
 * teaches ONLY the validity-dates check of RFC 5280 §4.1.2.5. Chain building,
 * name constraints, and extension processing are the Chain of Trust lab.
 */
import { concatBytes, fromUtf8 } from '../core/bytes';
import * as ed from '../crypto/ed25519';
import {
  TAG,
  bitString,
  derInt,
  derTime,
  expectTag,
  oid,
  parseDerTime,
  readChildren,
  readTlv,
  seq,
  set,
  tlv,
  utf8String,
} from '../der/der';

const OID_ED25519 = '1.3.101.112';
const OID_CN = '2.5.4.3';

export interface CertParams {
  serial: number;
  issuerCN: string;
  subjectCN: string;
  notBeforeMs: number;
  notAfterMs: number;
}

export interface Certificate {
  der: Uint8Array;
  /** the exact bytes the Ed25519 signature covers */
  tbs: Uint8Array;
  signature: Uint8Array;
  publicKey: Uint8Array;
  serial: number;
  issuerCN: string;
  subjectCN: string;
  notBeforeMs: number;
  notAfterMs: number;
}

const algId = () => seq(oid(OID_ED25519)); // Ed25519 AlgorithmIdentifier has NO parameters (RFC 8410 §3)
const name = (cn: string) => seq(set(seq(oid(OID_CN), utf8String(cn))));

/** Build and self-sign a certificate. Returns the full DER. */
export function createCertificate(params: CertParams, privateKey: Uint8Array): Certificate {
  const publicKey = ed.publicKeyOf(privateKey);
  const tbs = seq(
    tlv(TAG.CTX_0_CONSTRUCTED, derInt(2)), // version v3
    derInt(params.serial),
    algId(),
    name(params.issuerCN),
    seq(derTime(params.notBeforeMs), derTime(params.notAfterMs)),
    name(params.subjectCN),
    seq(algId(), bitString(publicKey)), // SubjectPublicKeyInfo
  );
  const signature = ed.sign(tbs, privateKey);
  const der = seq(tbs, algId(), bitString(signature));
  return { der, tbs, signature, publicKey, ...params };
}

function parseName(t: { tag: number; body: Uint8Array }): string {
  const rdns = readChildren(t.body);
  if (rdns.length !== 1) throw new Error('cert: expected exactly one RDN');
  const attrs = readChildren(expectTag(rdns[0], TAG.SET, 'RDN SET').body);
  const atv = readChildren(expectTag(attrs[0], TAG.SEQUENCE, 'AttributeTypeAndValue').body);
  expectTag(atv[0], TAG.OID, 'attribute type');
  return fromUtf8(expectTag(atv[1], TAG.UTF8_STRING, 'CN value').body);
}

function parseInt2(t: { body: Uint8Array }): number {
  let n = 0;
  for (const b of t.body) n = n * 256 + b;
  return n;
}

/** Strict parse; throws (fails closed) on anything outside the minimal profile. */
export function parseCertificate(der: Uint8Array): Certificate {
  const outer = readTlv(der);
  expectTag(outer, TAG.SEQUENCE, 'Certificate');
  if (outer.size !== der.length) throw new Error('cert: trailing bytes after Certificate');
  const [tbsTlv, sigAlg, sigVal] = readChildren(outer.body);
  const tbs = der.subarray(
    der.length - outer.body.length,
    der.length - outer.body.length + tbsTlv.size,
  );
  expectTag(tbsTlv, TAG.SEQUENCE, 'TBSCertificate');
  const sigAlgOid = readChildren(expectTag(sigAlg, TAG.SEQUENCE, 'signatureAlgorithm').body)[0];
  expectTag(sigAlgOid, TAG.OID, 'signature OID');
  const sigBits = expectTag(sigVal, TAG.BIT_STRING, 'signatureValue').body;
  if (sigBits[0] !== 0) throw new Error('cert: unused bits in signature BIT STRING');
  const signature = sigBits.subarray(1);

  const fields = readChildren(tbsTlv.body);
  if (fields.length !== 7) throw new Error('cert: unexpected TBSCertificate field count');
  const [ver, serial, , issuer, validity, subject, spki] = fields;
  expectTag(ver, TAG.CTX_0_CONSTRUCTED, 'version');
  if (parseInt2(readChildren(ver.body)[0]) !== 2) throw new Error('cert: only v3 supported');
  const [notBeforeT, notAfterT] = readChildren(expectTag(validity, TAG.SEQUENCE, 'Validity').body);
  const spkiParts = readChildren(expectTag(spki, TAG.SEQUENCE, 'SubjectPublicKeyInfo').body);
  const pkBits = expectTag(spkiParts[1], TAG.BIT_STRING, 'subjectPublicKey').body;
  if (pkBits[0] !== 0) throw new Error('cert: unused bits in public key BIT STRING');

  return {
    der,
    tbs: Uint8Array.from(tbs),
    signature: Uint8Array.from(signature),
    publicKey: Uint8Array.from(pkBits.subarray(1)),
    serial: parseInt2(expectTag(serial, TAG.INTEGER, 'serialNumber')),
    issuerCN: parseName(issuer),
    subjectCN: parseName(subject),
    notBeforeMs: parseDerTime(notBeforeT),
    notAfterMs: parseDerTime(notAfterT),
  };
}

/** Real Ed25519 verification of the certificate signature over the TBS bytes. */
export function verifyCertSignature(cert: Certificate, publicKey?: Uint8Array): boolean {
  return ed.verify(cert.signature, cert.tbs, publicKey ?? cert.publicKey);
}

/** Return a copy of the DER with one bit flipped inside the signature value. */
export function tamperSignatureBit(der: Uint8Array): Uint8Array {
  const out = Uint8Array.from(der);
  out[out.length - 1] ^= 0x01; // last signature byte lives at the very end
  return out;
}

export { concatBytes };
