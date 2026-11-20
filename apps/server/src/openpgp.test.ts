import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { signedAt, signingKeyOf } from './openpgp.ts';
import { signDetached, testKey } from './testing/openpgp-signer.ts';
import { YT_DLP_SIGNING_KEY, YT_DLP_SIGNING_KEY_FINGERPRINT } from './yt-dlp-signing-key.ts';

const RELEASE = join(import.meta.dirname, 'testing', 'yt-dlp-2026.10.26');
const sums = readFileSync(join(RELEASE, 'SHA2-256SUMS'));
const signature = readFileSync(join(RELEASE, 'SHA2-256SUMS.sig'));

describe('a signature of a release of yt-dlp, as its project made it', () => {
  const key = signingKeyOf(YT_DLP_SIGNING_KEY);

  it('reads the key Scia carries as the one whose fingerprint yt-dlp publishes', () => {
    expect(key.fingerprint).toBe(YT_DLP_SIGNING_KEY_FINGERPRINT);
  });

  it('is good for the bytes it was made of, and says when it was made', () => {
    expect(signedAt(sums, signature, key)?.toISOString().slice(0, 10)).toBe('2026-10-26');
  });

  it('is good for no other bytes: one character of the sums changed', () => {
    const changed = Buffer.from(sums);
    changed[0] = changed[0] === 0x30 ? 0x31 : 0x30;
    expect(signedAt(changed, signature, key)).toBeUndefined();
  });

  it('is good for no other key', () => {
    expect(signedAt(sums, signature, signingKeyOf(testKey().armored))).toBeUndefined();
  });

  it('is not one when a byte of the signature itself changed', () => {
    const changed = Buffer.from(signature);
    const last = changed.length - 1;
    changed[last] = (changed[last] ?? 0) ^ 0x01;
    expect(signedAt(sums, changed, key)).toBeUndefined();
  });

  it('is not one when the signature is cut short, or is no packet at all', () => {
    expect(signedAt(sums, signature.subarray(0, 100), key)).toBeUndefined();
    expect(signedAt(sums, Buffer.from('not a signature'), key)).toBeUndefined();
    expect(signedAt(sums, Buffer.alloc(0), key)).toBeUndefined();
  });
});

describe('a signature made with a key of the spec', () => {
  const made = testKey();
  const key = signingKeyOf(made.armored);
  const data = Buffer.from('e51e69e8  yt-dlp.exe\n');
  const at = new Date('2026-11-18T09:00:00Z');

  it('is good, and dated, for the hashes a release may use', () => {
    for (const hash of ['sha256', 'sha384', 'sha512'] as const) {
      expect(
        signedAt(data, signDetached(data, made.privateKey, { hash, createdAt: at }), key),
      ).toEqual(at);
    }
  });

  it('is refused when made with SHA-1, which no longer proves who signed', () => {
    expect(
      signedAt(data, signDetached(data, made.privateKey, { hash: 'sha1' }), key),
    ).toBeUndefined();
  });

  it('is refused when it is not a signature of a document, such as one of a key', () => {
    expect(
      signedAt(data, signDetached(data, made.privateKey, { type: 0x13 }), key),
    ).toBeUndefined();
  });

  it('is refused when it does not say when it was made', () => {
    expect(
      signedAt(data, signDetached(data, made.privateKey, { withoutDate: true }), key),
    ).toBeUndefined();
  });

  it('takes its date only from what it signs, never from the part anyone may change', () => {
    const date = Buffer.alloc(4);
    date.writeUInt32BE(Math.floor(at.getTime() / 1000));
    const undated = signDetached(data, made.privateKey, {
      withoutDate: true,
      unhashed: [[2, date]],
    });
    expect(signedAt(data, undated, key)).toBeUndefined();
  });

  it('is refused when it carries a condition marked critical that Scia does not read', () => {
    const critical = signDetached(data, made.privateKey, {
      extra: [[0x80 | 100, Buffer.from([1])]],
    });
    const plain = signDetached(data, made.privateKey, { extra: [[100, Buffer.from([1])]] });
    expect(signedAt(data, critical, key)).toBeUndefined();
    expect(signedAt(data, plain, key)).toBeDefined();
  });

  it('reads a key whose armour has a header, carriage returns and a checksum line', () => {
    const armored = made.armored
      .replace('\n\n', '\nComment: made for a spec\n\n')
      .replace('-----END', '=AAAA\n-----END')
      .replaceAll('\n', '\r\n');
    expect(signingKeyOf(armored).fingerprint).toBe(made.fingerprint);
  });

  it('is found among the signatures of several signers, and only when one is by the key', () => {
    const other = signDetached(data, testKey().privateKey, { createdAt: at });
    const ours = signDetached(data, made.privateKey, { createdAt: at });
    expect(signedAt(data, Buffer.concat([other, ours]), key)).toEqual(at);
    expect(signedAt(data, Buffer.concat([other, other]), key)).toBeUndefined();
  });

  it('refuses to read a key that is no armoured OpenPGP key', () => {
    expect(() => signingKeyOf('no key')).toThrow();
    expect(() =>
      signingKeyOf(
        '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nAAAA\n-----END PGP PUBLIC KEY BLOCK-----\n',
      ),
    ).toThrow();
  });
});
