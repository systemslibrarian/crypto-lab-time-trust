/**
 * Minimal DER (ITU-T X.690) encoder/decoder — hand-rolled because the
 * certificate here is a teaching object: the point is that the validity dates
 * live INSIDE the signed TBSCertificate bytes, and you can see exactly where.
 * Only the small subset X.509 needs is implemented; parsing is strict and
 * fails closed on anything malformed.
 */
import { concatBytes } from '../core/bytes';

export const TAG = {
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  NULL: 0x05,
  OID: 0x06,
  UTF8_STRING: 0x0c,
  UTCTIME: 0x17,
  GENERALIZED_TIME: 0x18,
  SEQUENCE: 0x30,
  SET: 0x31,
  CTX_0_CONSTRUCTED: 0xa0,
} as const;

function encodeLength(len: number): Uint8Array {
  if (len < 0x80) return Uint8Array.of(len);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>>= 8;
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

export function tlv(tag: number, body: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(tag), encodeLength(body.length), body);
}

export const seq = (...parts: Uint8Array[]) => tlv(TAG.SEQUENCE, concatBytes(...parts));
export const set = (...parts: Uint8Array[]) => tlv(TAG.SET, concatBytes(...parts));

/** DER INTEGER from a non-negative JS integer. */
export function derInt(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0) throw new Error('derInt: non-negative integers only');
  const bytes: number[] = [];
  let n = value;
  do {
    bytes.unshift(n & 0xff);
    n = Math.floor(n / 256);
  } while (n > 0);
  if (bytes[0] & 0x80) bytes.unshift(0); // keep it positive
  return tlv(TAG.INTEGER, Uint8Array.from(bytes));
}

/** BIT STRING with zero unused bits (all X.509 uses here are byte-aligned). */
export function bitString(bytes: Uint8Array): Uint8Array {
  return tlv(TAG.BIT_STRING, concatBytes(Uint8Array.of(0x00), bytes));
}

export function oid(dotted: string): Uint8Array {
  const parts = dotted.split('.').map(Number);
  if (parts.length < 2 || parts.some((p) => !Number.isInteger(p) || p < 0)) {
    throw new Error(`invalid OID: ${dotted}`);
  }
  const body: number[] = [parts[0] * 40 + parts[1]];
  for (const p of parts.slice(2)) {
    const chunk: number[] = [];
    let n = p;
    do {
      chunk.unshift(n & 0x7f);
      n >>>= 7;
    } while (n > 0);
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] |= 0x80;
    body.push(...chunk);
  }
  return tlv(TAG.OID, Uint8Array.from(body));
}

export function utf8String(s: string): Uint8Array {
  return tlv(TAG.UTF8_STRING, new TextEncoder().encode(s));
}

/**
 * RFC 5280 §4.1.2.5 date encoding rule: dates through 2049 MUST be UTCTime
 * (YYMMDDHHMMSSZ); dates in 2050 or later MUST be GeneralizedTime.
 */
export function derTime(ms: number): Uint8Array {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const rest = `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  if (y >= 1950 && y <= 2049) {
    return tlv(TAG.UTCTIME, new TextEncoder().encode(`${String(y % 100).padStart(2, '0')}${rest}`));
  }
  return tlv(TAG.GENERALIZED_TIME, new TextEncoder().encode(`${y}${rest}`));
}

// ---------------------------------------------------------------------------
// Strict reader
// ---------------------------------------------------------------------------

export interface Tlv {
  tag: number;
  /** content bytes */
  body: Uint8Array;
  /** total encoded length including header */
  size: number;
}

export function readTlv(bytes: Uint8Array, offset = 0): Tlv {
  if (offset + 2 > bytes.length) throw new Error('DER: truncated header');
  const tag = bytes[offset];
  let len = bytes[offset + 1];
  let headerLen = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error('DER: unsupported length form');
    if (offset + 2 + n > bytes.length) throw new Error('DER: truncated length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + bytes[offset + 2 + i];
    if (len < 0x80) throw new Error('DER: non-minimal length'); // strict DER
    headerLen = 2 + n;
  }
  if (offset + headerLen + len > bytes.length) throw new Error('DER: truncated body');
  return { tag, body: bytes.subarray(offset + headerLen, offset + headerLen + len), size: headerLen + len };
}

/** Read consecutive TLVs filling `body` exactly; throws on trailing garbage. */
export function readChildren(body: Uint8Array): Tlv[] {
  const out: Tlv[] = [];
  let off = 0;
  while (off < body.length) {
    const t = readTlv(body, off);
    out.push(t);
    off += t.size;
  }
  if (off !== body.length) throw new Error('DER: trailing bytes');
  return out;
}

export function expectTag(t: Tlv, tag: number, what: string): Tlv {
  if (t.tag !== tag) throw new Error(`DER: expected ${what} (tag 0x${tag.toString(16)}), got 0x${t.tag.toString(16)}`);
  return t;
}

/** Parse UTCTime (RFC 5280 sliding window: 00–49 → 20xx, 50–99 → 19xx) or GeneralizedTime. */
export function parseDerTime(t: Tlv): number {
  const s = new TextDecoder().decode(t.body);
  let m: RegExpMatchArray | null;
  if (t.tag === TAG.UTCTIME) {
    m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) throw new Error(`DER: malformed UTCTime "${s}"`);
    const yy = Number(m[1]);
    const year = yy <= 49 ? 2000 + yy : 1900 + yy;
    return Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  }
  if (t.tag === TAG.GENERALIZED_TIME) {
    m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/);
    if (!m) throw new Error(`DER: malformed GeneralizedTime "${s}"`);
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  }
  throw new Error('DER: not a time value');
}
