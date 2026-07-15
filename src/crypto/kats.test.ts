/**
 * Spec known-answer tests for the two primitives everything else builds on.
 *  - Ed25519: RFC 8032 §7.1 TEST 1–3            (3 KATs)
 *  - HMAC-SHA-256: RFC 4231 TC 1,2,3,4,6,7      (6 KATs)
 *  - HMAC-SHA-512: RFC 4231 TC 1,2              (2 KATs)
 *  - HMAC-SHA-1:  RFC 2202 TC 1,2               (2 KATs)
 */
import { describe, expect, it } from 'vitest';
import { fromHex, toHex, utf8 } from '../core/bytes';
import * as ed from './ed25519';
import { hmac } from './hmac';

const ED_VECTORS = [
  {
    name: 'RFC 8032 §7.1 TEST 1 (empty message)',
    sk: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
    pk: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    msg: '',
    sig: 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
  },
  {
    name: 'RFC 8032 §7.1 TEST 2 (one byte)',
    sk: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
    pk: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
    msg: '72',
    sig: '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
  },
  {
    name: 'RFC 8032 §7.1 TEST 3 (two bytes)',
    sk: 'c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7',
    pk: 'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025',
    msg: 'af82',
    sig: '6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a',
  },
];

describe('Ed25519 KATs (RFC 8032 §7.1)', () => {
  for (const v of ED_VECTORS) {
    it(v.name, () => {
      const sk = fromHex(v.sk);
      const msg = fromHex(v.msg);
      expect(toHex(ed.publicKeyOf(sk))).toBe(v.pk);
      const sig = ed.sign(msg, sk);
      expect(toHex(sig)).toBe(v.sig);
      expect(ed.verify(sig, msg, fromHex(v.pk))).toBe(true);
    });
  }

  it('rejects a signature with one flipped bit', () => {
    const v = ED_VECTORS[0];
    const sig = fromHex(v.sig);
    sig[0] ^= 0x01;
    expect(ed.verify(sig, fromHex(v.msg), fromHex(v.pk))).toBe(false);
  });

  it('fails closed on malformed signature bytes', () => {
    expect(ed.verify(new Uint8Array(3), new Uint8Array(0), fromHex(ED_VECTORS[0].pk))).toBe(false);
  });
});

const HMAC256_VECTORS = [
  {
    name: 'RFC 4231 TC1',
    key: fromHex('0b'.repeat(20)),
    data: utf8('Hi There'),
    mac: 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
  },
  {
    name: 'RFC 4231 TC2 (short key)',
    key: utf8('Jefe'),
    data: utf8('what do ya want for nothing?'),
    mac: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  },
  {
    name: 'RFC 4231 TC3',
    key: fromHex('aa'.repeat(20)),
    data: fromHex('dd'.repeat(50)),
    mac: '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe',
  },
  {
    name: 'RFC 4231 TC4',
    key: fromHex('0102030405060708090a0b0c0d0e0f10111213141516171819'),
    data: fromHex('cd'.repeat(50)),
    mac: '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b',
  },
  {
    name: 'RFC 4231 TC6 (key larger than block)',
    key: fromHex('aa'.repeat(131)),
    data: utf8('Test Using Larger Than Block-Size Key - Hash Key First'),
    mac: '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
  },
  {
    name: 'RFC 4231 TC7 (key and data larger than block)',
    key: fromHex('aa'.repeat(131)),
    data: utf8(
      'This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.',
    ),
    mac: '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2',
  },
];

describe('HMAC-SHA-256 KATs (RFC 4231)', () => {
  for (const v of HMAC256_VECTORS) {
    it(v.name, async () => {
      expect(toHex(await hmac('SHA-256', v.key, v.data))).toBe(v.mac);
    });
  }
});

describe('HMAC-SHA-512 KATs (RFC 4231)', () => {
  it('RFC 4231 TC1', async () => {
    expect(toHex(await hmac('SHA-512', fromHex('0b'.repeat(20)), utf8('Hi There')))).toBe(
      '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854',
    );
  });
  it('RFC 4231 TC2', async () => {
    expect(toHex(await hmac('SHA-512', utf8('Jefe'), utf8('what do ya want for nothing?')))).toBe(
      '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737',
    );
  });
});

describe('HMAC-SHA-1 KATs (RFC 2202)', () => {
  it('RFC 2202 TC1', async () => {
    expect(toHex(await hmac('SHA-1', fromHex('0b'.repeat(20)), utf8('Hi There')))).toBe(
      'b617318655057264e28bc0b6fb378c8ef146be00',
    );
  });
  it('RFC 2202 TC2', async () => {
    expect(toHex(await hmac('SHA-1', utf8('Jefe'), utf8('what do ya want for nothing?')))).toBe(
      'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79',
    );
  });
});
